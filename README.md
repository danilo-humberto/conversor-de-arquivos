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

| Serviço               | Endereço local               |
| --------------------- | ---------------------------- |
| Interface e API       | http://localhost:3000        |
| Health da API         | http://localhost:3000/health |
| Painel RabbitMQ       | http://localhost:15672       |
| Console MinIO         | http://localhost:9001        |
| API e downloads MinIO | http://localhost:9000        |
| E-mails no Mailpit    | http://localhost:8025        |

Os painéis RabbitMQ e MinIO usam os usuários e senhas definidos para seus respectivos serviços no Compose ou no `.env`. Mailpit captura mensagens localmente; o teste não envia e-mail para um provedor externo.

Para encerrar os containers preservando os volumes:

```sh
docker compose down
```

## Configuração por variáveis de ambiente

O Compose funciona com seus valores locais padrão sem criar `.env`. Para personalizar, crie um `.env` na raiz contendo apenas as variáveis que deseja substituir. Exemplo sem credenciais:

```dotenv
PORT=

POSTGRES_HOST=
POSTGRES_PORT=
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=

RABBITMQ_HOST=
RABBITMQ_PORT=
RABBITMQ_DEFAULT_USER=
RABBITMQ_DEFAULT_PASS=
RABBITMQ_VHOST=

MINIO_ENDPOINT=
MINIO_PORT=
MINIO_USE_SSL=
MINIO_ROOT_USER=
MINIO_ROOT_PASSWORD=

MAX_UPLOAD_SIZE_BYTES=

SMTP_HOST=
SMTP_PORT=
MAIL_FROM=
```

O arquivo `.env.example` lista as variáveis lidas pela aplicação. Ele contém campos vazios e precisa ser preenchido se usado para processos Node fora do Compose. Não versionar `.env` ou credenciais reais.

Na execução direta com Node, uma variável vazia nem sempre equivale a uma variável ausente. Em particular, `MAX_UPLOAD_SIZE_BYTES=` causa erro: preencha com `104857600` (100 MiB) ou remova a linha para usar o padrão.

### Variáveis personalizáveis no Compose

| Variável                                            | Uso e padrão local                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Banco, usuário e senha; padrões de desenvolvimento definidos no Compose.                    |
| `RABBITMQ_DEFAULT_USER`, `RABBITMQ_DEFAULT_PASS`    | Credenciais locais do broker e do painel.                                                   |
| `RABBITMQ_VHOST`                                    | Vhost usado pela aplicação; padrão `/`. Outro vhost precisa existir no broker antes do uso. |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`            | Credenciais locais do armazenamento e do console.                                           |
| `MINIO_PUBLIC_ENDPOINT`                             | Host acessível ao navegador; padrão `localhost`, sem protocolo ou caminho.                  |
| `MINIO_PUBLIC_PORT`, `MINIO_PUBLIC_USE_SSL`         | Porta e HTTPS dos links de download; padrões `9000` e `false`.                              |
| `MINIO_SOURCE_URL_EXPIRY_SECONDS`                   | Validade da URL de origem; padrão e máximo `604800` segundos (sete dias).                   |
| `MAX_UPLOAD_SIZE_BYTES`                             | Limite positivo de upload; padrão `104857600` bytes (100 MiB).                              |
| `OUTBOX_POLL_INTERVAL_MS`                           | Intervalo positivo de consulta da outbox; padrão `1000` ms.                                 |
| `MAIL_FROM`                                         | Remetente das notificações; padrão `no-reply@conversor.local`.                              |

Dentro dos containers, o Compose fixa `PORT=3000`, `POSTGRES_HOST=postgres`, `POSTGRES_PORT=5432`, `RABBITMQ_HOST=rabbitmq`, `RABBITMQ_PORT=5672`, `MINIO_ENDPOINT=minio`, `MINIO_PORT=9000`, `MINIO_USE_SSL=false`, `SMTP_HOST=mailpit` e `SMTP_PORT=1025`. Alterar essas variáveis somente no `.env` não modifica esses valores literais nem as portas publicadas no Compose.

Os hosts internos são nomes dos serviços Docker. Já os links recebidos pelo navegador usam `MINIO_PUBLIC_*`. Ao acessar por outra máquina, o host público precisa ser alcançável por ela; `localhost` sempre se refere à máquina de quem abre o link. A validade do download é de 24 horas, definida no código; consultar novamente o job concluído gera uma nova URL.

Alterar credenciais no `.env` não reconfigura automaticamente usuários já criados em volumes persistentes. Não apagar volumes para aplicar uma alteração de configuração.

### Executar comandos Node no host

Opcionalmente, use Node.js 22, execute `npm ci` e preencha `.env` conforme `.env.example`, com os hosts dos serviços locais e todas as variáveis obrigatórias de `src/config/env.ts`. Para serviços publicados nesta máquina, os hosts são `localhost`, em vez dos nomes Docker. Os comandos de validação em container abaixo já recebem a configuração do Compose e dispensam essa preparação no host.

Para executar o worker de conversão no host com `npm run worker:conversion`, também é necessário instalar o FFmpeg e disponibilizar o executável no `PATH`; confira com `ffmpeg -version`. No Docker, o `Dockerfile.worker` já instala o FFmpeg.

## Buckets e ciclo de vida dos arquivos

Os buckets **`uploads` e `converted` são criados automaticamente**, se ausentes, na inicialização do worker de conversão e no fluxo de criação de jobs. A operação tolera duas réplicas tentando criar o mesmo bucket. Não é necessário criá-los manualmente pelo console.

1. A API grava a origem em `uploads` no MinIO antes de iniciar a transação PostgreSQL. Nessa transação, cria o job com estado `PENDENTE` e o evento inicial na outbox; após o commit, retorna HTTP `202` com `jobId`. O upload não participa da transação do banco: não há atomicidade entre MinIO e PostgreSQL. A publicação no RabbitMQ acontece posteriormente pelo dispatcher.
2. O worker reserva o job, baixa a origem pela URL assinada da mensagem, converte e grava `converted/<jobId>/result.<formato>`.
3. A URL do resultado é gerada e a transação confirma `CONCLUÍDO` junto do evento final. Só depois a origem é removida.
4. Se a limpeza falhar, a mensagem retorna ao retry de 30 segundos. A reentrega de um job concluído retoma somente a remoção idempotente.
5. Falhas definitivas anteriores à conclusão preservam a origem para diagnóstico e registram `ERRO`. O worker de notificação envia o resultado ou a mensagem de erro.

Enquanto a limpeza aguarda recuperação, o resultado pode estar disponível e a origem ainda presente. Não há expiração automática dos resultados ou retenção automática de DLQs.

## Uso da interface e API

Abra a interface, selecione áudio ou vídeo, escolha um destino compatível e informe um e-mail. A página de acompanhamento consulta o estado imediatamente e, enquanto ele for `PENDENTE` ou `PROCESSANDO`, agenda a próxima consulta para três segundos após a resposta. Se a consulta falhar, tenta novamente após cinco segundos. Ao receber `CONCLUÍDO` ou `ERRO`, interrompe as consultas. Abra o Mailpit para conferir a notificação e o link assinado.

| Endpoint           | Comportamento                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `POST /jobs`       | Multipart com `file`, `targetFormat` e `notifyEmail`; retorna `202` com `{ "jobId": "uuid", "status": "PENDENTE" }`. |
| `GET /jobs/:jobId` | Estado, formatos, datas e disponibilidade do resultado; inclui download quando concluído.                            |
| `GET /health`      | Disponibilidade do processo HTTP; não é uma verificação completa de todas as dependências.                           |

Entrada inválida retorna `400`, arquivo acima do limite retorna `413`, UUID inválido retorna `400` e job inexistente retorna `404`. Falhas internas retornam `500`.

## Escalar os workers

```sh
docker compose up -d --build --scale conversion-worker=2
docker compose ps conversion-worker
```

## Garantias de entrega e recuperação

- Filas duráveis, mensagens persistentes, confirmação do publicador (_publisher confirms_) e reconhecimento manual do consumidor (_ack_) sustentam entrega **ao menos uma vez**. A outbox recupera eventos pendentes, mas pode republicar se o broker confirmar e a gravação de `PUBLISHED` falhar. Consumidores precisam tolerar duplicidade.
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

## Documentação

- [Relatório técnico](docs/relatorio-entrega.md) e [PDF para entrega](output/pdf/relatorio-entrega.pdf).
- [Contratos e garantias](docs/contratos.md).
- [Validação integrada](docs/validacao-integrada.md) e [evidências das correções](output/validation/correcoes-resultados.json).
- [Arquitetura](docs/arquitetura.md) e [sequência](docs/sequencia.md).
