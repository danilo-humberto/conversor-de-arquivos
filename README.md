# Conversor de arquivos

Sistema distribuído de conversão assíncrona de áudio e vídeo. A API recebe o upload, o MinIO armazena os arquivos e o RabbitMQ distribui o processamento para workers independentes.

## Executar localmente

É necessário ter o Docker Desktop em execução. Para iniciar todo o ambiente, execute:

    docker compose up --build

A composição inicia PostgreSQL, RabbitMQ, MinIO, Mailpit, migrations, API, dispatcher da outbox e os workers de conversão e notificação. Os valores padrão são exclusivos para desenvolvimento local; variáveis equivalentes em `.env` substituem esses valores.

Os containers usam `minio:9000` internamente. Os links enviados por e-mail usam `MINIO_PUBLIC_ENDPOINT` e, por padrão local, apontam para `localhost:9000`. Em outro ambiente, configure essa variável com o host público do MinIO.

Depois da inicialização, acesse:

- Conversor: http://localhost:3000
- RabbitMQ: http://localhost:15672
- MinIO: http://localhost:9001
- Mailpit: http://localhost:8025

## Escalar conversões

Para executar dois workers de conversão, use:

    docker compose up --build --scale conversion-worker=2

O RabbitMQ distribui os jobs entre os workers. A outbox usa locks no PostgreSQL para publicar cada evento pendente uma única vez.

## Validar

    npm run typecheck
    docker compose config --quiet

No fluxo manual, envie um arquivo de áudio ou vídeo pela interface. O status deve evoluir de `PENDENTE` para `PROCESSANDO` e `CONCLUÍDO`; o e-mail será visível no Mailpit.
