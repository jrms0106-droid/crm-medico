# Resposta a incidentes de segurança

> Plano inicial para validar com o encarregado de dados e um advogado. Prazos e conteúdo da
> comunicação à ANPD e aos titulares seguem a LGPD (art. 48) e a Resolução CD/ANPD nº 15/2024;
> confirme a versão vigente antes de usar.

## Papéis (a nomear)

| Papel                      | Quem        | Faz                                                               |
| -------------------------- | ----------- | ----------------------------------------------------------------- |
| Responsável pelo incidente | (a definir) | decide, coordena e registra                                       |
| Encarregado de dados (DPO) | (a definir) | avalia o risco aos titulares e faz as comunicações                |
| Responsável técnico        | (a definir) | contém, investiga e recupera                                      |
| Diretor clínico            | (a definir) | avalia impacto no atendimento e decide como atender sem o sistema |

## Exemplos do que é incidente

Acesso de quem não devia ao prontuário (inclusive de alguém da equipe); conta comprometida;
perda ou roubo de computador logado; cópia do banco ou do backup fora do lugar; alteração não
explicada de registro ou de pagamento; elo quebrado na verificação da trilha de auditoria;
sistema fora do ar por ataque.

## Passos

1. **Detectar e registrar.** Anotar data e hora, quem percebeu, o que viu. Abrir o registro
   do incidente (modelo abaixo). Não apagar nada.
2. **Conter.**
   - Conta suspeita: o administrador desativa o usuário (encerra as sessões na hora) e depois
     redefine o acesso.
   - Muitas contas ou o servidor: tirar a API do ar no proxy da hospedagem e trocar a senha de
     `crm_app` ([banco-e-papeis.md](banco-e-papeis.md)).
   - Chave vazada: trocar a chave no cofre e planejar a recriptografia (CPF e MFA).
3. **Preservar evidências.** Exportar a trilha de auditoria do período, rodar a verificação da
   cadeia e guardar o resultado; guardar logs da hospedagem; fazer backup antes de qualquer
   correção.
4. **Avaliar o risco.** Quais dados, quantos pacientes, se havia dado de saúde (sempre
   sensível), se havia criptografia, se o dado pode ser usado contra o titular.
5. **Comunicar**, se houver risco ou dano relevante aos titulares: à ANPD e aos titulares
   afetados, no prazo da norma vigente (a Resolução CD/ANPD nº 15/2024 fala em **três dias
   úteis** a partir do conhecimento; validar). A comunicação diz o que aconteceu, quais dados,
   os riscos, as medidas tomadas e o contato do encarregado.
6. **Recuperar.** Se necessário, restaurar de backup em banco separado
   ([backup-e-restauracao.md](backup-e-restauracao.md)), conferir e só então trocar. A trilha
   de auditoria deve ser verificada de novo.
7. **Aprender.** Reunião em até uma semana: causa, o que falhou, o que muda. Atualizar a
   [modelagem de ameaças](../conformidade/modelagem-de-ameacas.md).

## Atendimento sem o sistema

Se o sistema ficar fora do ar: atender com ficha em papel numerada; ao voltar, o médico digita
o registro com a data real do atendimento indicada no texto e guarda o papel conforme a guarda
do prontuário.

## Modelo de registro do incidente

```text
Número:
Detectado em (data/hora) e por quem:
Descrição:
Dados e pacientes afetados (quantidade, tipo):
Medidas de contenção (o quê, quem, quando):
Evidências guardadas (onde):
Avaliação de risco aos titulares:
Comunicação à ANPD (sim/não, data, protocolo):
Comunicação aos titulares (sim/não, data, meio):
Causa:
Ações para não repetir:
Encerrado em:
```

## Treino

Ensaio de mesa a cada seis meses com os papéis acima, usando um dos exemplos. O ensaio de
restauração do backup é mensal.
