# Contratos e garantias

## HTTP

`POST /jobs` recebe `multipart/form-data` com `file`, `targetFormat` e `notifyEmail`. Rejeita MIME fora de áudio/vídeo com `400`, limita o tamanho pelo ambiente (100 MB por padrão) e retorna `202` com `{ "jobId": "uuid", "status": "PENDENTE" }`.

`GET /jobs/:jobId` retorna o status, formatos, datas, `resultAvailable` e, quando concluído, uma URL assinada de download. UUID inválido retorna `400`; job inexistente retorna `404`.

## Eventos RabbitMQ

| Evento | Destino | Campos relevantes |
| --- | --- | --- |
| `conversion.requested` | `conversion.jobs` | `eventId`, `jobId`, `sourceUrl` assinada, tipo, formatos, e-mail, data e tentativa. |
| `conversion.finished` | `notification.jobs` | `eventId`, `jobId`, e-mail, status, URL do resultado ou erro e data. |

Os parsers exigem conjunto exato de chaves, UUIDs, datas ISO-8601, e-mail válido e URL HTTP(S). A URL de origem também exige os parâmetros de assinatura MinIO.

## Garantias práticas

- **Durabilidade do pedido:** job e evento inicial ficam juntos na transação do PostgreSQL; o dispatcher recupera eventos pendentes ou leases expirados.
- **Entrega ao menos uma vez:** mensagens podem ser reenviadas. Consumidores devem tolerar duplicidade.
- **Exclusão mútua por job:** token e lease condicionam reivindicação, renovação, conclusão e falha.
- **Teto de processamento:** conversão e notificação reservam no máximo três tentativas, incluindo quedas. A recuperação de um pedido esgotado apenas finaliza o estado e encaminha à DLQ. Esperas por job ocupado ou banco indisponível não contam como processamento nem possuem teto global de reentregas.
- **Cancelamento por perda de posse:** falha de renovação ou expiração local cancela o FFmpeg e aguarda seu encerramento antes de limpar os temporários. Isso reduz sobreposição; não garante execução exatamente uma vez durante partições de rede ou quedas antes de persistir o resultado.
- **Resultado idempotente:** se `converted/<jobId>/result.<formato>` já existir, o worker não baixa nem converte novamente; a exclusão da origem também é idempotente.
- **Limpeza recuperável:** a URL e a transação `CONCLUÍDO`/outbox são confirmadas antes de remover a origem. Falhas anteriores preservam a origem. Se a remoção falhar depois da conclusão, a mensagem volta para retry de 30 segundos; a reentrega consulta o job concluído e retoma apenas a exclusão idempotente, sem reconverter ou emitir outro evento final. Durante essa espera, o resultado já está disponível e a origem pode continuar no storage.
- **Notificação com resultado incerto:** falhas comprovadas antes da aceitação SMTP permitem retry até três tentativas. Timeout/desconexão com resultado desconhecido, lease `SENDING` expirado ou falha ao gravar `SENT` após aceitação não liberam novo envio: registram `FAILED`, motivo em `last_error` e DLQ para revisão. Se o banco também impedir esse registro, a mensagem permanece sem ack e a reserva `SENDING` será recuperada sem reenviar. Essa política pode exigir intervenção mesmo quando nenhum e-mail foi entregue; SMTP e PostgreSQL não garantem entrega exatamente uma vez.

## Diagnóstico de notificações que exigem revisão

Consultar `notifications.status`, `attempt_count` e `last_error` pelo jobId e localizar a mensagem em `notification.dlq`. `FAILED` pode significar tentativas esgotadas ou resultado incerto; não prova ausência de entrega. No ambiente local, conferir no Mailpit o destinatário e o Message-ID determinístico antes de decidir sobre uma recuperação manual. Republicar a DLQ não reinicia automaticamente uma notificação `FAILED`. Não resetar esse estado sem confirmar o resultado, pois isso pode duplicar uma mensagem já aceita pelo SMTP.
