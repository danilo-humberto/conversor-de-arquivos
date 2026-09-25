# Sequencia de processamento

```mermaid
sequenceDiagram
  participant C as Cliente
  participant A as API
  participant S as MinIO
  participant D as PostgreSQL
  participant O as Dispatcher
  participant Q as RabbitMQ
  participant W as Worker de conversão
  participant N as Worker de notificação
  participant M as SMTP

  C->>A: POST /jobs (arquivo, formato, e-mail)
  A->>S: grava origem
  A->>D: cria job PENDENTE + outbox requested (transação)
  A-->>C: 202 { jobId, status }
  O->>D: reivindica evento PENDING com lease
  O->>Q: publica conversion.requested e aguarda confirmação
  O->>D: marca evento PUBLISHED
  Q->>W: entrega mensagem
  W->>D: UPDATE condicional para PROCESSANDO + token/lease
  W->>S: baixa origem, converte, grava resultado e remove origem
  W->>D: CONCLUÍDO/ERRO + outbox finished (transação)
  O->>Q: publica conversion.finished
  Q->>N: entrega mensagem
  N->>D: reivindica notificação com token/lease
  N->>M: envia e-mail
  N->>D: marca SENT
```

## Falhas e reentregas

O worker de conversão usa `prefetch(1)`. A reivindicação do job é um `UPDATE` condicional: apenas um worker recebe o token válido. O lease dura 120 segundos e o heartbeat tenta renová-lo a cada 30 segundos. Se a posse é perdida, o worker não conclui o job e a mensagem volta para retry de 30 segundos.

Falhas comuns de conversão liberam o job para `PENDENTE` e enviam a mensagem para retry de 5 segundos na primeira tentativa ou 30 segundos na segunda. Na terceira falha, o job recebe `ERRO`, um evento final e a mensagem vai para `conversion.dlq`. A notificação segue três tentativas e, no esgotamento, fica `FAILED` e vai para `notification.dlq`.

As filas de retry são duráveis e usam TTL com dead-letter de volta para a fila principal. Antes de reconhecer uma mensagem reenviada, o worker publica a nova mensagem com confirmação do RabbitMQ.
