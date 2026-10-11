# Validação do sistema local — 11/10/2026

## Correções posteriores à validação inicial

As três falhas funcionais abaixo foram corrigidas após autorização. O histórico original permanece neste documento para comparar os resultados.

- MIME não permitido agora produz `JobValidationError`, tratado como HTTP 400; o teste HTTP verifica que a rota nem é executada.
- A conversão gera a URL e confirma `CONCLUÍDO`/outbox antes de excluir a origem. A limpeza consulta o estado concluído e usa os metadados persistidos. Falha de limpeza agenda retry de 30 segundos, sem alterar o estado final; a reentrega retoma somente a remoção.
- Envio SMTP e gravação de `SENT` foram separados. Falhas comprovadas antes da aceitação permitem até três tentativas. Aceitação seguida de falha no banco, resultado SMTP ambíguo e `SENDING` expirado vão para `FAILED`/DLQ com motivo para revisão, sem novo envio. Se a gravação desse motivo também falhar, a mensagem fica sem ack e a recuperação da reserva impede reenvio.

A mudança não exige migração, pacote novo ou alteração da arquitetura Docker. Há uma escolha explícita: notificações incertas podem exigir intervenção mesmo se não tiverem sido entregues. Essa política evita reenvio automático nas janelas ambíguas; não garante entrega externa exatamente uma vez. Consultar [garantias e diagnóstico](contratos.md).

Os testes de regressão comprovaram HTTP 400, apenas um e-mail após falha em `SENT`, e origem preservada após três falhas de assinatura. Dois cenários adicionais comprovaram retomada da limpeza com apenas uma tentativa/evento final, e recuperação de `SENDING` após falhas nas duas gravações do banco sem duplicar o e-mail. Banco, storage e SMTP foram reais; falhas de finalização foram injetadas nos handlers.

### Comandos e resultado após as correções

| Comando | Resultado |
| --- | --- |
| `npm.cmd test` | 60 aprovados no Windows. O teste HTTP precisou executar fora do sandbox para acessar o servidor local temporário; passou nessa execução. |
| `npm.cmd run typecheck` | Aprovado no host. |
| `docker compose exec -T conversion-worker npm test` | 60 aprovados no Linux. |
| `docker compose exec -T api npm run typecheck` | Aprovado. |
| `docker compose up -d --build --scale conversion-worker=2` | Imagens reconstruídas e serviços iniciados com o código corrigido. |
| `node tmp/validation/run.mjs "--only=Reject non-media,SMTP accepted,Finalization failure" --result=tmp/validation/fix-regressions.json` | Três regressões aprovadas. |
| `node tmp/validation/run.mjs --result=tmp/validation/fix-full-results.json` | **21 cenários aprovados, zero falhas**. Inclui quatro conversões, downloads, e-mails, reentregas, concorrência, tentativas/DLQ, cancelamento real, falhas SMTP, limpeza e queda de worker. |
| `git diff --check` | Aprovado. |
| `docker compose up -d --scale conversion-worker=1 conversion-worker` | Quantidade original de um worker restaurada após os testes. |

Evidências atuais: [correcoes-resultados.json](../output/validation/correcoes-resultados.json). O último teste interrompeu o worker ativo durante FFmpeg; outra réplica concluiu o pedido `13e1d8b0-23e1-4877-8d32-20c2249dbd84` com duas tentativas e um e-mail. Os dados de teste foram preservados. Interface e benchmark não foram repetidos nesta correção; suas verificações anteriores continuam registradas abaixo. Nenhum resultado desta rodada representa uma garantia absoluta de entrega SMTP exatamente uma vez.

## Resultado da rodada inicial

O fluxo principal de áudio e vídeo, a recuperação de workers, o teto de tentativas e a escalabilidade foram comprovados com serviços reais. A validação também reproduziu **três falhas funcionais**, que impedem considerar todos os cenários aprovados.

- Suíte automatizada: **55 testes aprovados**, tanto no Windows quanto no container Linux; zero falhas nessas execuções.
- Cenários programáticos de integração/injeção de falha: **16 aprovados e 3 reprovados**.
- Fluxo pela interface no navegador: aprovado.
- Benchmark com um e dois workers: aprovado.
- Auditoria de dependências: quatro pacotes com alertas moderados; sem alertas altos ou críticos no resultado obtido.

As evidências consolidadas estão em [output/validation/results.json](../output/validation/results.json). A aplicação não foi corrigida durante esta rodada de validação.

## Ambiente e método

Os containers foram reconstruídos com o código atual por `docker compose up -d --build --scale conversion-worker=2`. A validação usou PostgreSQL, RabbitMQ, MinIO, Mailpit e FFmpeg reais. Os volumes existentes foram preservados; não foi testada uma instalação com volumes vazios.

Foram usados áudios senoidais e vídeos de teste gerados artificialmente, e destinatários locais identificados por `validation-*`. E-mails ficaram no Mailpit. Não foram usados arquivos pessoais, SMTP externo ou produção.

A suíte de integração temporária está em `tmp/validation/run.mjs`, pasta ignorada pelo Git. Ela faz uploads HTTP, confirma armazenamento, consulta estado no banco, verifica codecs com FFprobe, republica mensagens e identifica os pedidos de teste nas DLQs. Alguns cenários reservam registros sintéticos diretamente para reproduzir estados interrompidos. Os testes das janelas de falha chamam os handlers com falhas injetadas, usando banco, armazenamento ou SMTP reais; não simulam uma indisponibilidade global do ambiente.

## Cenários aprovados

| Cenário | Evidência |
| --- | --- |
| Health e consulta HTTP | Health 200; UUID inválido 400; job inexistente 404. |
| Validação de campos | Arquivo ausente, formato incompatível, e-mail inválido/ausente, destino ausente e nome sem extensão retornaram 400. |
| Limite de upload | Arquivo com 104.857.601 bytes retornou 413; limite configurado de 104.857.600 bytes. |
| WAV → MP3 | Resultado reconhecido como MP3 pelo FFprobe. |
| MP3 → WAV | Resultado reconhecido como PCM s16le. |
| MP4 → WebM | Resultado reconhecido como VP9. |
| WebM → MP4 | Resultado reconhecido como H.264. |
| Ciclo normal de arquivos | Nas quatro conversões, origem removida, resultado presente e download HTTP 200. |
| Notificação normal | Um e-mail por conversão; URL no corpo acessível com HTTP 200. |
| Reentregas após conclusão | Três republicações do pedido e três do evento final mantiveram uma tentativa de conversão, uma tentativa de notificação e um e-mail. |
| Arquivo corrompido | Três tentativas, job ERRO, origem preservada, resultado ausente e mensagem na conversion.dlq. |
| Terceira conversão interrompida | Lease expirado com contador 3 terminou em ERRO/DLQ sem quarta conversão. |
| Terceira notificação interrompida | Lease expirado com contador 3 terminou em FAILED/DLQ, sem envio adicional. |
| Mensagem malformada | Encaminhada à conversion.dlq. |
| Concorrência no PostgreSQL | Duas reservas concorrentes tiveram apenas um vencedor, tanto para conversão quanto para notificação. Contadores observados: 1, 2, 3, 3. |
| Perda de posse com FFmpeg real | Token substituído em um job sintético. No heartbeat seguinte, em cerca de 30 segundos, o FFmpeg foi cancelado e seu fechamento foi confirmado. |
| Queda de worker durante conversão | Container com FFmpeg ativo foi interrompido; outra réplica recuperou o job após expiração do lease. Resultado final com duas tentativas, origem removida e um e-mail. |
| Falha de conexão SMTP | Um worker temporário recebeu SMTP_PORT=9, enquanto o worker normal ficou parado. Após retries reais, a notificação terminou FAILED, com três tentativas, zero e-mails e mensagem na notification.dlq. Mailpit permaneceu ativo. |

O teste de queda usou o job `02088da6-bb4f-4472-8397-4f7a11ff048e`. A réplica interrompida e a sobrevivente foram distintas. Essa evidência confirma recuperação; não significa que o cálculo interrompido pelo FFmpeg foi executado exatamente uma vez.

Os testes de esgotamento inicialmente foram interrompidos por `ENAMETOOLONG`, limite de tamanho do comando no Windows. O arquivo sintético inserido pelo script foi reduzido e ambos os cenários foram repetidos com sucesso. Essa falha do instrumento de teste não foi contabilizada como falha da aplicação no resultado consolidado.

## Interface gráfica

No navegador, foi selecionado um WAV de teste, o destino MP3 foi habilitado, o formulário foi enviado e o modal de aceite apareceu. O botão de acompanhamento abriu outra aba com o jobId; a página mostrou CONCLUÍDO e o link de download.

Job dessa verificação: `2b75ad9d-2684-4e86-a787-b78187a6fe30`. A confirmação visual foi capturada durante a execução. As quatro conversões e os downloads foram também verificados pelos testes HTTP.

## Benchmark executado

Comando: `node scripts/benchmark-workers.mjs`.

Dois lotes de oito WAVs determinísticos de 30 segundos, 48 kHz mono, convertidos para MP3. O tempo medido inclui envio, processamento e acompanhamento até concluir o lote.

| Workers | Tempo do lote | Vazão |
| --- | ---: | ---: |
| 1 | 3,290 s | 2,432 jobs/s |
| 2 | 1,969 s | 4,064 jobs/s |

Ganho aproximado de **67,1% de vazão**, com redução de **40,2% no tempo do lote**. Cada lote teve oito IDs distintos, oito resultados distintos e uma tentativa por job. Foram confirmados um consumidor na primeira rodada e dois na segunda.

Esses números são desta execução local. Não substituem os números históricos do relatório anterior nem estimam capacidade de produção.

## Falhas reproduzidas na rodada inicial — corrigidas posteriormente

### 1. Upload de arquivo não permitido retorna 500

- Reprodução: enviar um arquivo `text/plain` para `POST /jobs`.
- Esperado: HTTP 400, erro de entrada do cliente.
- Obtido: HTTP 500 com `Internal server error.`.
- Causa observada: [upload.ts](../src/api/upload.ts) cria um `Error` genérico; [error-handler.ts](../src/api/error-handler.ts) não o reconhece como erro de validação.
- Já existia antes dos ajustes de tentativas; esses arquivos não foram modificados nessa etapa.
- Ajuste recomendado: classificar a rejeição como erro de validação e acrescentar teste HTTP de regressão, preservando 500 para falhas internas.

### 2. SMTP aceita o e-mail, mas falha ao registrar SENT

- Reprodução: no primeiro envio de um pedido sintético, o SMTP real aceitou o e-mail; foi injetada uma falha em `markNotificationAsSent`. Em seguida, o handler foi executado novamente com persistência normal.
- Esperado pelo requisito estrito: apenas um e-mail.
- Obtido: **dois e-mails**, estado final SENT e contador de duas tentativas.
- Job: `e2b5ebe6-9204-4ca7-b39a-866d9a923b8a`.
- Relação com o código: [handle-notification-message.ts](../src/workers/handle-notification-message.ts) envia antes de marcar SENT e libera a notificação para retry quando essa persistência falha.
- Limite já identificado no checklist: banco e SMTP não participam de uma única transação. Message-ID igual não impediu o Mailpit de receber duas mensagens.
- Próxima decisão: definir tratamento de resultado incerto e, se for exigida deduplicação estrita, avaliar um mecanismo no serviço de envio. Marcar SENT antes de enviar trocaria duplicidade por risco de perda.

### 3. Falha de conclusão depois da limpeza perde a origem de diagnóstico

- Reprodução: foi inserido um resultado sintético preexistente; a geração da URL foi configurada para falhar depois da remoção real da origem. O handler foi executado nas três tentativas.
- Esperado: ao terminar em ERRO, preservar a origem para diagnóstico.
- Obtido: **job ERRO, três tentativas e origem ausente**, embora o objeto de resultado permanecesse.
- Job: `d4061802-abea-422a-aca0-7b9a921e0ad9`.
- Relação com o código: [process-claimed-conversion-job.ts](../src/workers/process-claimed-conversion-job.ts) remove a origem antes de gerar a URL e concluir a transação do job.
- Próxima etapa: reorganizar conclusão e limpeza, com recuperação de limpeza pendente e distinção entre falha da conversão e falha posterior de finalização.

As falhas 2 e 3 são reproduções determinísticas com injeção localizada, não incidentes espontâneos observados no fluxo normal.

## Dependências

`docker compose exec -T api npm audit --json` retornou código 1 e quatro pacotes com severidade moderada na cadeia do SDK MinIO:

| Pacote instalado | Versão |
| --- | --- |
| minio | 8.0.7 |
| query-string | 7.1.3 |
| decode-uri-component | 0.2.2 |
| stream-json | 1.9.1 |

A auditoria não demonstra exploração no projeto. Nenhum pacote ou lockfile foi alterado. A sugestão automática envolve mudança principal de versão do MinIO e precisa de análise própria; não foi aplicado `npm audit fix --force`.

## Comandos e evidências de execução

| Comando | Resultado |
| --- | --- |
| `npm.cmd test` | 55 aprovados no Windows. |
| `npm.cmd run typecheck` | Aprovado. |
| `docker compose exec -T conversion-worker npm test` | 55 aprovados no Linux. |
| `docker compose exec -T api npm run typecheck` | Aprovado. |
| `docker compose exec -T api npm run db:check` | Aprovado. |
| `docker compose exec -T api npm run broker:check` | Aprovado. |
| `docker compose exec -T api npm run storage:check` | Aprovado. |
| `docker compose exec -T api npm run smtp:check` | Aprovado. |
| `node tmp/validation/run.mjs` | Rodada principal: fluxo real, reentregas, corrupto, mensagem inválida e queda. Falha MIME e dois cenários interrompidos pelo script. |
| `node tmp/validation/run.mjs "--only=Expired third" --result=tmp/validation/recovery-results.json` | Dois cenários repetidos: aprovados. |
| `node tmp/validation/run.mjs "--only=Concurrent" --result=tmp/validation/concurrency-results.json` | Duas validações SQL reais: aprovadas. |
| `node tmp/validation/run.mjs "--only=Additional input,Real FFmpeg,SMTP connection" --result=tmp/validation/additional-results.json` | Três cenários aprovados. |
| `node tmp/validation/run.mjs "--only=SMTP accepted,Finalization failure" --result=tmp/validation/failure-window-results.json` | Duas falhas conhecidas reproduzidas. |
| `node scripts/benchmark-workers.mjs` | Aprovado. |
| `docker compose config --quiet` | Aprovado. |
| `docker compose ps` | Serviços ativos; health checks disponíveis aprovados. |
| `docker compose exec -T rabbitmq rabbitmqctl list_queues -p / name messages_ready messages_unacknowledged consumers` | Filas principais/retry sem mensagens pendentes ou não reconhecidas; consumidores normais ativos. |
| `docker compose exec -T api npm audit --json` | Reprovado por alertas moderados. |
| `docker compose exec -T api npm ls minio query-string decode-uri-component stream-json` | Versões acima confirmadas. |

## Estado final e limites

O ambiente foi restaurado para **um worker de conversão**, quantidade existente no início. O worker normal de notificação voltou a executar; o worker SMTP temporário foi encerrado. Mailpit, banco, broker e MinIO permaneceram com seus dados existentes.

Pedidos, resultados, e-mails e entradas em DLQ de teste foram preservados como evidência. Não houve purge de filas, exclusão de volumes ou limpeza de dados anteriores. As DLQs possuem mensagens esperadas dos testes; isso não é sinal de trabalho normal bloqueado.

Não foram cobertas todas as combinações de formatos, codecs, falhas simultâneas ou cargas possíveis. Também não foram executados instalação com volumes vazios, envio SMTP externo, implantação em produção ou medições de capacidade de produção. Os testes validam os cenários descritos, não uma garantia absoluta de exatamente uma vez.

As três correções funcionais estão descritas no início deste documento. Os alertas moderados de dependências continuam pendentes de uma etapa específica de análise e atualização; não foram alterados neste ajuste.
