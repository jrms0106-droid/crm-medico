# ADR 0032: código de 6 dígitos (MFA) obrigatório para todos os perfis

- **Status:** aceito (2026-11-02, decisão do responsável no item 6 da [revisão de segurança](../revisao/2026-11-01-revisao-de-seguranca.md))
- **Decisão:** O padrão de `MFA_REQUIRED_ROLES` passa de `doctor,admin` para `doctor,admin,secretary`. A secretária cadastra o aplicativo autenticador no próximo login e passa a confirmar o código ao entrar e nas ações que pedem a senha de novo.
- **Motivo:** A secretária vê CPF, telefone, endereço e agenda de todos os pacientes da unidade. Só com a senha, uma senha vazada ou adivinhada bastaria para ver esses dados.
- **Alternativas descartadas:** manter opcional para a secretária (risco aceito sem necessidade); exigir só fora da rede da clínica (depende da hospedagem e da rede, que não existem ainda).
- **Consequências:** Cada secretária precisa de um celular com aplicativo autenticador. Perda do celular: o administrador redefine o acesso, como já acontece com médico e administrador. A configuração continua ajustável por variável de ambiente, mas tirar um perfil da lista é uma decisão que precisa de novo ADR.
- **Revisar quando:** Houver login único da clínica (por exemplo, conta corporativa com MFA própria) ou chave física (passkey).
