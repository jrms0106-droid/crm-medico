# Revisão de segurança e de código: teleconsulta e Memed simulada (PRs #56 a #61)

Revisão feita pelo Claude em 2026-11-10 sobre o que entrou nos PRs #56 (teleconsulta), #57 (marca de telemedicina), #60 (Memed simulada) e #61 (cópia FHIR). Não substitui revisão independente.

## O que foi conferido

| Ponto                                                 | Resultado                                                                                                                                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toda rota nova tem teste de acesso permitido e negado | `tele-consent` (secretária permitida; médico, administrador e secretária de outra unidade barrados, com auditoria) e `external-documents/memed` (médico com vínculo permitido; secretária, administrador e médico sem vínculo barrados; outra organização 404) |
| Só um caminho cria atendimento                        | `care.service.ts` é o único; a trava do consentimento vale para todos                                                                                                                                                                                          |
| Dados enviados ao fornecedor                          | Vídeo: só código da consulta e horários. Prescrição: prescritor, nome e nascimento do paciente e itens, nada além (teste confere as chaves)                                                                                                                    |
| Banco                                                 | Restrições `CHECK` recusam sala ou consentimento em consulta presencial e plataforma desconhecida                                                                                                                                                              |
| Resumo SHA-256 dos documentos                         | A chave `telemedicine` só entra no retrato quando verdadeira; documento presencial mantém o resumo (teste)                                                                                                                                                     |
| Recibos simulados                                     | Aviso "sem validade legal" no resumo, na tela, no código e na cópia FHIR, que não se passa por documento do CFM (teste)                                                                                                                                        |

## Achados corrigidos neste PR

1. **Receita grande era cortada em silêncio (médio).** A receita simulada aceitava até 10 itens de 500 caracteres, mas o resumo gravado tem limite de 2.000 e era cortado com `slice`: medicamentos do fim da receita sumiam do registro sem aviso. Agora a validação recusa a receita que não cabe, com mensagem clara, e o texto é montado por uma função só (`memedPrescriptionSummary`). Teste novo cobre os dois lados.
2. **Endereço da sala virava link sem conferência (baixo hoje, alto com fornecedor real).** O endereço devolvido pelo adaptador de vídeo ia direto para o `href`. Um fornecedor com falha ou comprometido poderia devolver `javascript:`. Agora só `https` sem espaços e até 300 caracteres é aceito; senão a marcação falha e nada é gravado. Teste novo.

## Limites conhecidos (não corrigidos)

- **Registro retificado depois que o atendimento acabou** não mostra a marca de telemedicina, porque a marca vem do atendimento aberto no momento em que o registro foi criado. É coerente (o registro novo não foi feito na teleconsulta), mas pode surpreender; vai para a conferência clínica.
- **Sala criada dentro da transação da marcação**, com a trava da agenda. Com fornecedor lento, a agenda fica travada por mais tempo (anotado no ADR 0043).
- **Link da sala no lembrete** fica gravado em `crm.outbound_messages` como o resto do texto. Com WhatsApp real, entra na revisão de privacidade do fornecedor.
- **Leitor de tela:** os formulários do consentimento e da Memed têm rótulos e foram vistos no e2e, mas a verificação automática (axe) não roda com esses formulários abertos. Ficou para uma próxima rodada de acessibilidade.
- A receita simulada não pode ser cancelada "no fornecedor" (não existe); o cancelamento só afeta o registro.
