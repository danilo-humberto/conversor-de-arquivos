# Relatorio de entrega - Conversor de arquivos distribuidos

## Problema e solucao

O sistema converte audio e video sem bloquear a requisicao HTTP. A API salva a origem no MinIO, grava o job e o evento inicial em uma transacao PostgreSQL; um dispatcher publica o evento no RabbitMQ. Workers independentes processam a conversao com FFmpeg e um worker separado notifica o usuario por e-mail.

## Arquitetura e fluxo

```mermaid
flowchart LR
  API[API] --> DB[(PostgreSQL + outbox)] --> MQ[RabbitMQ]
  API --> IN[(MinIO uploads)]
  MQ --> CW[Workers de conversao] --> OUT[(MinIO converted)]
  CW --> DB
  MQ --> NW[Worker de notificacao] --> SMTP[SMTP]
```

A outbox evita a lacuna entre criar o job e publicar a mensagem. O dispatcher reivindica eventos com lease, publica mensagens persistentes e espera confirmacao do broker. A consulta de status retorna uma URL de download apenas para jobs concluidos.

## Confiabilidade

Cada job e reivindicado com token e lease de 120 segundos, renovado a cada 30 segundos. Assim, duas replicas nao devem processar simultaneamente o mesmo job. O resultado tem chave deterministica por job; se ja existir numa reentrega, o worker finaliza sem reconverter. As filas de retry usam 5 e 30 segundos; apos tres falhas, as mensagens seguem para DLQ. A entrega e ao menos uma vez, portanto nao se promete exatamente uma vez ponta a ponta.

## Benchmark real

Foram enviados dois lotes identicos: oito WAVs de 30 segundos, primeiro com uma replica e depois com duas. O tempo mede do primeiro envio ate todos os jobs concluidos.

| Workers | Tempo do lote | Vazao | Variacao |
| --- | ---: | ---: | ---: |
| 1 | 5,994 s | 1,335 jobs/s | referencia |
| 2 | 3,509 s | 2,280 jobs/s | +71% |

Os dois lotes criaram 16 jobs, cada um com resultado distinto e uma tentativa. A fila apresentou um consumidor na primeira rodada e dois na segunda. O ganho nao chega a 100% porque upload, banco, broker, armazenamento e consulta de status tambem participam da medicao.

## Limites e demonstracao

O ambiente e local e nao implementa autenticacao, cancelamento nem retencao automatica de objetos/DLQs. O roteiro completo esta em `roteiro-demonstracao.md`; a explicacao acessivel do benchmark esta em `benchmark-explicacao.md`.
