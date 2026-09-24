# Sequencia de processamento

```mermaid
sequenceDiagram
  participant C as Cliente
  participant A as API
  participant S as MinIO
  participant D as PostgreSQL
  participant O as Dispatcher
  participant Q as RabbitMQ
  participant W as Worker de conversao
  participant N as Worker de notificacao
  participant M as SMTP

  C->>A: POST /jobs (arquivo, formato, e-mail)
  A->>S: grava origem
  A->>D: cria job PENDENTE + outbox requested (transacao)
  A-->>C: 202 { jobId, status }
  O->>D: reivindica evento PENDING com lease
  O->>Q: publica conversion.requested e aguarda confirmacao
  O->>D: marca evento PUBLISHED
  Q->>W: entrega mensagem
  W->>D: UPDATE condicional para PROCESSANDO + token/lease
  W->>S: baixa origem, converte, grava resultado e remove origem
  W->>D: CONCLUÍDO/ERRO + outbox finished (transacao)
  O->>Q: publica conversion.finished
  Q->>N: entrega mensagem
  N->>D: reivindica notificacao com token/lease
  N->>M: envia e-mail
  N->>D: marca SENT
```

## Falhas e reentregas

O worker de conversao usa `prefetch(1)`. A reivindicacao do job e um `UPDATE` condicional: apenas um worker recebe o token valido. O lease dura 120 segundos e o heartbeat tenta renova-lo a cada 30 segundos. Se a posse e perdida, o worker nao conclui o job e a mensagem volta para retry de 30 segundos.

Falhas comuns de conversao liberam o job para `PENDENTE` e enviam a mensagem para retry de 5 segundos na primeira tentativa ou 30 segundos na segunda. Na terceira falha, o job recebe `ERRO`, um evento final e a mensagem vai para `conversion.dlq`. A notificacao segue tres tentativas e, no esgotamento, fica `FAILED` e vai para `notification.dlq`.

As filas de retry sao duraveis e usam TTL com dead-letter de volta para a fila principal. Antes de reconhecer uma mensagem reenviada, o worker publica a nova mensagem com confirmacao do RabbitMQ.
