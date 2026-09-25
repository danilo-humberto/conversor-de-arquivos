# Arquitetura do conversor distribuído

## Objetivo

O sistema recebe arquivos de áudio e vídeo, converte-os de forma assíncrona e notifica o usuário por e-mail. A API apenas aceita o pedido; o trabalho pesado é executado por workers que podem ser escalados horizontalmente.

## Componentes

```mermaid
flowchart LR
  U[Usuário/navegador] --> API[API Express]
  API -->|arquivo| S[(MinIO: uploads)]
  API -->|job + evento na mesma transação| DB[(PostgreSQL)]
  DB --> O[Dispatcher da outbox]
  O -->|conversion.requested| CQ[[RabbitMQ: conversion.jobs]]
  CQ --> W[Worker de conversão + FFmpeg]
  W -->|resultado| R[(MinIO: converted)]
  W -->|conclusão/erro + evento| DB
  DB --> O
  O -->|conversion.finished| NQ[[RabbitMQ: notification.jobs]]
  NQ --> N[Worker de notificação]
  N --> M[SMTP/Mailpit]
  U -->|consulta| API
  API --> DB
```

| Componente            | Responsabilidade                                                |
| --------------------- | --------------------------------------------------------------- |
| API Express           | valida upload, cria job e expõe consulta de status.             |
| PostgreSQL            | fonte de verdade dos jobs, eventos da outbox e notificações.    |
| MinIO                 | armazena a origem em `uploads` e o resultado em `converted`.    |
| RabbitMQ              | entrega mensagens persistentes, retries por TTL e filas DLQ.    |
| Dispatcher            | publica eventos pendentes da outbox após confirmação do broker. |
| Worker de conversão   | reivindica o job, executa FFmpeg e persiste o resultado.        |
| Worker de notificação | envia a mensagem de conclusão ou erro, com retries.             |

## Estado persistido

`jobs` possui os estados `PENDENTE`, `PROCESSANDO`, `CONCLUÍDO` e `ERRO`. O job em processamento possui token e lease. `outbox_events` registra `PENDING`, `PUBLISHING` ou `PUBLISHED`; um evento é único por `(job_id, event_type)`. `notifications` registra `PENDING`, `SENDING`, `SENT` ou `FAILED`.

O upload no MinIO ocorre antes da transação. Dentro dela, job e evento `conversion.requested` são gravados juntos. Em caso de falha da transação, a origem enviada é removida. Ao terminar ou falhar, o worker atualiza o job e grava `conversion.finished` na mesma transação.

## Decisões e limites

- O broker oferece entrega ao menos uma vez; não há promessa de exatamente uma vez ponta a ponta.
- A idempotência da conversão é obtida por token/lease no banco e pela verificação do objeto de resultado antes de reconverter.
- URLs de origem e download são assinadas. A URL de origem possui prazo máximo configurado de sete dias; a URL de download é criada na consulta de status.
- A composição é voltada ao ambiente local. Credenciais padrão e serviços expostos não devem ser usados como configuração de produção.
- O sistema não persiste qual réplica executou um job. O benchmark verifica consumidores e resultados, não afinidade entre job e container.
