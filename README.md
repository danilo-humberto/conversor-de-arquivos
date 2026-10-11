# Conversor de arquivos

Sistema distribuído de conversão assíncrona de áudio e vídeo. A interface envia o arquivo à API; MinIO armazena os objetos, RabbitMQ distribui os pedidos e workers independentes executam FFmpeg. Outro worker envia o e-mail pelo SMTP local Mailpit.

Destinos disponíveis: **MP3 e WAV para áudio; MP4 e WebM para vídeo**. A API valida MIME informado, extensão, destino e e-mail. O processamento verifica se o FFmpeg consegue interpretar o conteúdo; um arquivo corrompido pode ser aceito inicialmente e terminar em `ERRO`.

## Executar com Docker Compose

Pré-requisitos: Docker Desktop com o Engine ativo e Docker Compose. Execute na raiz do repositório:

```sh
docker compose up -d --build
docker compose ps
```

O Compose inicia PostgreSQL, RabbitMQ, MinIO, Mailpit, API, dispatcher da outbox e os workers. O serviço `migrate` aplica as migrações existentes antes de iniciar os componentes que dependem do banco. A interface estática é servida pelo Express da API; não há container exclusivo de frontend.

| Serviço | Endereço local |
| --- | --- |
| Interface e API | http://localhost:3000 |
| Health da API | http://localhost:3000/health |
| Painel RabbitMQ | http://localhost:15672 |
| Console MinIO | http://localhost:9001 |
| API e downloads MinIO | http://localhost:9000 |
| E-mails no Mailpit | http://localhost:8025 |

Os painéis RabbitMQ e MinIO usam os usuários e senhas definidos para seus respectivos serviços no Compose ou no `.env`. Mailpit captura mensagens localmente; o teste não envia e-mail para um provedor externo.

Para encerrar os containers preservando os volumes:

```sh
docker compose down
```

## Configuração por variáveis de ambiente

O Compose funciona com seus valores locais padrão sem criar `.env`. Para personalizar, crie um `.env` na raiz contendo apenas as variáveis que deseja substituir. Exemplo sem credenciais:

```dotenv
MINIO_PUBLIC_ENDPOINT=localhost
MINIO_PUBLIC_PORT=9000
MINIO_PUBLIC_USE_SSL=false
MINIO_SOURCE_URL_EXPIRY_SECONDS=604800
MAX_UPLOAD_SIZE_BYTES=104857600
OUTBOX_POLL_INTERVAL_MS=1000
MAIL_FROM=no-reply@conversor.local
```

O arquivo `.env.example` lista as variáveis lidas pela aplicação. Ele contém campos vazios e precisa ser preenchido se usado para processos Node fora do Compose. Não versionar `.env` ou credenciais reais.

### Variáveis personalizáveis no Compose

| Variável | Uso e padrão local |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Banco, usuário e senha; padrões de desenvolvimento definidos no Compose. |
| `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS` | Credenciais locais do broker e do painel. |
| `RABBITMQ_VHOST` | Vhost usado pela aplicação; padrão `/`. Outro vhost precisa existir no broker antes do uso. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Credenciais locais do armazenamento e do console. |
| `MINIO_PUBLIC_ENDPOINT` | Host acessível ao navegador; padrão `localhost`, sem protocolo ou caminho. |
| `MINIO_PUBLIC_PORT`, `MINIO_PUBLIC_USE_SSL` | Porta e HTTPS dos links de download; padrões `9000` e `false`. |
| `MINIO_SOURCE_URL_EXPIRY_SECONDS` | Validade da URL de origem; padrão e máximo `604800` segundos (sete dias). |
| `MAX_UPLOAD_SIZE_BYTES` | Limite positivo de upload; padrão `104857600` bytes (100 MiB). |
| `OUTBOX_POLL_INTERVAL_MS` | Intervalo positivo de consulta da outbox; padrão `1000` ms. |
| `MAIL_FROM` | Remetente das notificações; padrão `no-reply@conversor.local`. |

Dentro dos containers, o Compose fixa `PORT=3000`, `POSTGRES_HOST=postgres`, `POSTGRES_PORT=5432`, `RABBITMQ_HOST=rabbitmq`, `RABBITMQ_PORT=5672`, `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`, `SMTP_HOST=mailpit` e `SMTP_PORT=1025`. Alterar essas variáveis somente no `.env` não modifica esses valores literais nem as portas publicadas no Compose.

Os hosts internos são nomes dos serviços Docker. Já os links recebidos pelo navegador usam `MINIO_PUBLIC_*`. Ao acessar por outra máquina, o host público precisa ser alcançável por ela; `localhost` sempre se refere à máquina de quem abre o link. A validade do download é de 24 horas, definida no código; consultar novamente o job concluído gera uma nova URL.

Alterar credenciais no `.env` não reconfigura automaticamente usuários já criados em volumes persistentes. Não apagar volumes para aplicar uma alteração de configuração.

### Executar comandos Node no host

Opcionalmente, use Node.js 22, execute `npm ci` e preencha `.env` conforme `.env.example`, com os hosts dos serviços locais e todas as variáveis obrigatórias de `src/config/env.ts`. Para serviços publicados nesta máquina, os hosts são `localhost`, em vez dos nomes Docker. Os comandos de validação em container abaixo já recebem a configuração do Compose e dispensam essa preparação no host.

## Buckets e ciclo de vida dos arquivos

Os buckets **`uploads` e `converted` são criados automaticamente**, se ausentes, na inicialização do worker de conversão e no fluxo de criação de jobs. A operação tolera duas réplicas tentando criar o mesmo bucket. Não é necessário criá-los manualmente pelo console.

1. A API grava a origem em `uploads`, cria `PENDENTE` e o evento inicial na mesma transação PostgreSQL e retorna HTTP `202` com `jobId`. A publicação no RabbitMQ acontece posteriormente pelo dispatcher.
2. O worker reserva o job, baixa a origem pela URL assinada da mensagem, converte e grava `converted/<jobId>/result.<formato>`.
3. A URL do resultado é gerada e a transação confirma `CONCLUÍDO` junto do evento final. Só depois a origem é removida.
4. Se a limpeza falhar, a mensagem retorna ao retry de 30 segundos. A reentrega de um job concluído retoma somente a remoção idempotente.
5. Falhas definitivas anteriores à conclusão preservam a origem para diagnóstico e registram `ERRO`. O worker de notificação envia o resultado ou a mensagem de erro.

Enquanto a limpeza aguarda recuperação, o resultado pode estar disponível e a origem ainda presente. Não há expiração automática dos resultados ou retenção automática de DLQs.

## Uso da interface e API

Abra a interface, selecione áudio ou vídeo, escolha um destino compatível e informe um e-mail. A página de acompanhamento consulta o estado a cada três segundos: `PENDENTE`, `PROCESSANDO`, `CONCLUÍDO` ou `ERRO`. Abra o Mailpit para conferir a notificação e o link assinado.

| Endpoint | Comportamento |
| --- | --- |
| `POST /jobs` | Multipart com `file`, `targetFormat` e `notifyEmail`; retorna `202` com `{ "jobId": "uuid", "status": "PENDENTE" }`. |
| `GET /jobs/:jobId` | Estado, formatos, datas e disponibilidade do resultado; inclui download quando concluído. |
| `GET /health` | Disponibilidade do processo HTTP; não é uma verificação completa de todas as dependências. |

Entrada inválida retorna `400`, arquivo acima do limite retorna `413`, UUID inválido retorna `400` e job inexistente retorna `404`. Falhas internas retornam `500`.

## Escalar os workers e medir o ganho

```sh
docker compose up -d --build --scale conversion-worker=2
docker compose ps conversion-worker
```

O benchmark precisa controlar o Docker e acessar a API pelo host. Execute-o na raiz do projeto, com Node.js disponível:

```sh
node scripts/benchmark-workers.mjs
```

O benchmark cria dois lotes idênticos de oito WAVs determinísticos de 30 segundos: primeiro com um worker, depois com dois. Mede do primeiro envio até a conclusão do lote, calcula jobs/s e verifica consumidores, IDs/resultados distintos e uma tentativa por job. Ao terminar, restaura a quantidade inicial de workers; os registros e objetos dos testes são preservados.

`BENCHMARK_JOBS` e `BENCHMARK_AUDIO_SECONDS` ajustam o tamanho do lote e do áudio. O teste mede o fluxo completo, incluindo upload, banco, broker, storage e consulta. Não há registro persistido de qual réplica processou cada job. Na medição registrada em 11/10/2026, a vazão passou de 2,432 para 4,064 jobs/s com dois workers (+67,1%); os valores dependem da máquina e da carga.

## Garantias de entrega e recuperação

- Filas duráveis, mensagens persistentes, confirmação do publicador (*publisher confirms*) e reconhecimento manual do consumidor (*ack*) sustentam entrega **ao menos uma vez**. A outbox recupera eventos pendentes, mas pode republicar se o broker confirmar e a gravação de `PUBLISHED` falhar. Consumidores precisam tolerar duplicidade.
- `prefetch(1)` limita cada worker de conversão a uma mensagem não reconhecida por vez. Token e lease de 120 segundos coordenam a posse no banco; heartbeat a cada 30 segundos renova a reserva.
- Perda de posse cancela o FFmpeg e aguarda seu encerramento antes de limpar temporários. Um resultado já persistido é reutilizado; reentregar `CONCLUÍDO` não reconverte.
- Conversões têm no máximo três tentativas reservadas, inclusive após queda. Falhas comuns usam retries de 5 e 30 segundos e terminam em `ERRO`/`conversion.dlq` ao esgotar o teto.
- Notificações permitem até três tentativas quando há comprovação de não aceitação SMTP. Resultado incerto, `SENDING` expirado ou falha ao registrar `SENT` após aceite seguem para `FAILED`/`notification.dlq`, com motivo para revisão e sem reenvio automático. Isso pode exigir intervenção mesmo sem entrega comprovada; Message-ID determinístico não garante deduplicação pelo servidor externo.
- Esperas por banco indisponível, job ocupado e limpeza posterior à conclusão não consomem nova tentativa de conversão; não possuem teto global de reentregas.

## Validar e diagnosticar

Com o ambiente ativo, execute os checks existentes:

```sh
docker compose config --quiet
docker compose exec -T api npm run typecheck
docker compose exec -T conversion-worker npm test
docker compose exec -T api npm run db:check
docker compose exec -T api npm run broker:check
docker compose exec -T api npm run storage:check
docker compose exec -T api npm run smtp:check
```

`storage:check` cria buckets ausentes; `smtp:check` verifica a conexão SMTP. No host configurado, os equivalentes para código são `npm run typecheck` e `npm test`.

A etapa funcional concluída registrou **60 testes aprovados no Windows e no Linux, typecheck aprovado e 21 cenários integrados sem falhas**. Foram cobertas conversões WAV→MP3, MP3→WAV, MP4→WebM e WebM→MP4; downloads; notificações; reentregas; concorrência; tentativas/DLQ; cancelamento; limpeza e recuperação após queda. Esses são resultados da execução registrada, não testes executados automaticamente ao abrir este README.

Para diagnóstico:

```sh
docker compose logs --tail=100 api outbox-dispatcher conversion-worker notification-worker
docker compose exec -T rabbitmq rabbitmqctl list_queues -p / name messages_ready messages_unacknowledged consumers
```

Localize o `jobId` no banco, nos logs e na DLQ correspondente. Para `FAILED` de notificação, confira `last_error` e o Mailpit antes de decidir por recuperação manual. Republicar a mensagem não reinicia automaticamente uma notificação `FAILED`. Mensagens sintéticas nas DLQs foram preservadas como evidência dos testes.

## Documentação e limites

- [Relatório técnico](docs/relatorio-entrega.md) e [PDF para entrega](output/pdf/relatorio-entrega.pdf).
- [Contratos e garantias](docs/contratos.md).
- [Validação integrada](docs/validacao-integrada.md) e [evidências das correções](output/validation/correcoes-resultados.json).
- [Arquitetura](docs/arquitetura.md) e [sequência](docs/sequencia.md).

O ambiente é local, com banco e broker únicos, frontend servido pela API e dependência do mesmo esquema PostgreSQL entre os processos. Não implementa autenticação, isolamento por usuário, retenção automática ou alta disponibilidade. A imagem MinIO usa `latest` e a auditoria registrada apresenta quatro pacotes com alertas moderados. Para produção, seriam necessários revisão de dependências, imagens fixadas, credenciais por serviço, TLS, controle de acesso, backups testados, limites de recursos e observabilidade. A entrega ao menos uma vez e a integração SMTP não garantem execução/entrega exatamente uma vez ponta a ponta.
