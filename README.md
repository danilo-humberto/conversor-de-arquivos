# Conversor de arquivos

Sistema distribuído de conversão assíncrona de áudio e vídeo. A API recebe o upload, o MinIO armazena os arquivos e o RabbitMQ distribui o processamento para workers independentes.

## Executar localmente

É necessário ter o Docker Desktop em execução. Para iniciar todo o ambiente, execute:

    docker compose up --build

A composição inicia PostgreSQL, RabbitMQ, MinIO, Mailpit, migrations, API, dispatcher da outbox e os workers de conversão e notificação. Os valores padrão são exclusivos para desenvolvimento local; variáveis equivalentes em `.env` substituem esses valores.

Os containers usam `minio:9000` internamente. Os links enviados por e-mail usam `MINIO_PUBLIC_ENDPOINT` e, por padrão local, apontam para `localhost:9000`. Em outro ambiente, configure essa variável com o host público do MinIO.

## Prazos do processamento

- A URL assinada do arquivo de origem é válida por sete dias (`MINIO_SOURCE_URL_EXPIRY_SECONDS=604800`, por padrão).
- Cada conversão tem um *lease* de 120 segundos: é a reserva temporária que impede que dois workers processem o mesmo job ao mesmo tempo.
- Enquanto processa, o worker renova esse lease por meio de um *heartbeat* a cada 30 segundos. Se a renovação falhar ou o lease expirar, o processamento deixa de ter posse do job e não pode concluí-lo.

Depois da inicialização, acesse:

- Conversor: http://localhost:3000
- RabbitMQ: http://localhost:15672
- MinIO: http://localhost:9001
- Mailpit: http://localhost:8025

## Escalar conversões

Para executar dois workers de conversão, use:

    docker compose up --build --scale conversion-worker=2

O RabbitMQ distribui os jobs entre os workers. A outbox usa locks no PostgreSQL para publicar cada evento pendente uma única vez.

### Benchmark de workers

Com a composição local em execução e a API acessível em `http://localhost:3000`, rode:

    npm run benchmark:workers

O benchmark gera o mesmo WAV determinístico em memória e submete dois lotes iguais (oito jobs de 30 segundos, por padrão): primeiro com um worker e depois com dois. Ele mede o tempo desde o primeiro envio até a conclusão do lote, calcula jobs por segundo, confirma IDs e resultados distintos, uma tentativa por job e consumidores ativos na fila. O script restaura a quantidade inicial de containers de conversão ao terminar. Os jobs e objetos resultantes permanecem no ambiente local.

É possível ajustar o tamanho do lote e do áudio com `BENCHMARK_JOBS` e `BENCHMARK_AUDIO_SECONDS`. A comparação inclui o tempo de envio pela API e espera dos status, portanto serve como benchmark ponta a ponta do fluxo local; resultados dependem dos recursos da máquina e dos serviços locais. O RabbitMQ distribui mensagens entre consumidores, mas o sistema não persiste qual container processou cada job.

## Validar

    npm run typecheck
    docker compose config --quiet

No fluxo manual, envie um arquivo de áudio ou vídeo pela interface. O status deve evoluir de `PENDENTE` para `PROCESSANDO` e `CONCLUÍDO`; o e-mail será visível no Mailpit.
