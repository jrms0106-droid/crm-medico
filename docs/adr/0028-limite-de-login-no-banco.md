# ADR 0028: limite de tentativas de login guardado no banco

- **Status:** aceito (2026-11-01, pendência 1 da revisão geral)
- **Decisão:** O limite de tentativas de login por origem (IP) passa da memória do processo para a tabela `identity.login_rate_limits`, em janelas fixas de um minuto. Cada tentativa é contada numa única instrução atômica (`INSERT ... ON CONFLICT DO UPDATE`), e a chave é guardada como SHA-256, nunca o IP. Janelas vencidas são apagadas quando uma janela nova começa.
- **Motivo:** Com mais de uma instância da API, cada uma contava separado e o limite real virava o limite vezes o número de instâncias. O banco já é compartilhado por todas e não exige serviço novo.
- **Alternativas descartadas:** Redis ou serviço de cache (mais um serviço para contratar e operar); limite só no proxy reverso (depende da hospedagem, ainda não escolhida, e não fica testado aqui).
- **Consequências:** Uma escrita no banco a cada tentativa de login. O bloqueio por conta (5 falhas) continua igual. Guardar o resumo do IP ainda é tratamento de dado; a tabela só tem a janela do último minuto.
- **Revisar quando:** A hospedagem for escolhida (pode haver limite no proxy também) ou o volume de logins tornar a escrita por tentativa um gargalo.
