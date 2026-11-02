# Pedido de cotação de hospedagem: AWS e Azure (2026-11-02)

> **Nada foi enviado, contratado ou cadastrado.** Este é o texto para o responsável enviar, se e
> quando quiser, aos dois fornecedores recomendados no
> [comparativo de fornecedores](comparativo-de-fornecedores.md). Cotação não obriga a contratar.
> Contratar depende da autorização por escrito do responsável e da leitura jurídica do contrato.
>
> **No pedido, não mande** dados de pacientes, chaves, senhas nem o endereço do repositório. Para
> orçar, o fornecedor só precisa do porte e da lista abaixo.

## Como usar

1. Preencha os campos entre colchetes da seção 1.
2. Envie o mesmo texto (seções 1 a 4) aos dois fornecedores, pelo formulário de vendas do site de
   cada um ou por uma revenda autorizada no Brasil. Mandar o mesmo texto deixa as respostas
   comparáveis.
3. Peça a resposta **por escrito**, com preço mensal por item, moeda, impostos e a validade da
   proposta.
4. Anote as respostas na tabela da seção 5. As calculadoras públicas
   ([AWS](https://calculator.aws), [Azure](https://azure.microsoft.com/pricing/calculator/)) servem
   para conferir se o valor proposto está na mesma ordem de grandeza.

## 1. Quem pede e para quê

- **Empresa:** [nome da clínica ou empresa], CNPJ [número].
- **Contato:** [nome], [e-mail], [telefone].
- **Sistema:** prontuário eletrônico e gestão de clínica médica com várias especialidades, feito
  sob medida. Uma API (Node.js) e um site (PWA), com banco PostgreSQL. Ainda não está em uso real.
- **Porte inicial:** até 5 médicos, de 10 a 30 consultas por dia, 1 unidade. Poucos usuários ao
  mesmo tempo (menos de 20).
- **Dados:** dados de saúde, que são dados sensíveis pela LGPD (art. 11). Por isso pedimos tudo
  **em região no Brasil**.

## 2. Itens a cotar

Peça o preço de cada item separado, em região no Brasil (AWS: São Paulo, `sa-east-1`; Azure:
Brazil South). Os nomes de máquina são exemplos do porte desejado; o fornecedor pode propor um
equivalente.

| #   | Item                                        | Especificação                                                                                                                                                                                                                                                                       | Exemplo AWS                                  | Exemplo Azure                                              |
| --- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| 1   | Servidor da API e do site (produção)        | Linux, 2 vCPU, 4 GB de memória, 30 GB de disco SSD, ligado o tempo todo.                                                                                                                                                                                                            | EC2 t4g.medium ou t3.medium                  | Máquina virtual B2s                                        |
| 2   | PostgreSQL 16 gerenciado (produção)         | 2 vCPU, 2 a 4 GB, 20 GB de disco que possa crescer, criptografia em repouso, backup automático com retenção de 7 a 35 dias e **recuperação para um ponto no tempo**. Poder criar papéis de banco e rodar `pg_dump`. Peça o preço **com e sem** alta disponibilidade (segunda zona). | RDS for PostgreSQL, db.t4g.small             | Database for PostgreSQL, servidor flexível, B1ms ou B2s    |
| 3   | Cópia dos backups em outro lugar            | Cerca de 10 GB, retenção de 30 dias. Os arquivos já vão cifrados pelo sistema. Veja a pergunta 3.5.                                                                                                                                                                                 | S3 (outra região ou classe de armazenamento) | Blob Storage (Brazil Southeast, se disponível)             |
| 4   | Cofre de segredos                           | Cerca de 5 segredos (chaves de criptografia, senha do banco, endereço do banco), com registro de quem leu.                                                                                                                                                                          | Secrets Manager ou KMS                       | Key Vault                                                  |
| 5   | HTTPS e proxy na frente da API              | Certificado gerenciado e renovado sozinho, HSTS, limite de requisições por endereço. Firewall de aplicação (WAF) como opcional, com preço à parte.                                                                                                                                  | Application Load Balancer ou CloudFront, WAF | Application Gateway ou Front Door, WAF                     |
| 6   | Registros de acesso e alertas               | Registro de quem acessou o painel, o servidor e o banco, guardado por pelo menos 1 ano. Alertas por e-mail de indisponibilidade e de disco cheio.                                                                                                                                   | CloudTrail e CloudWatch                      | Activity Log e Azure Monitor                               |
| 7   | Tráfego de saída                            | Cerca de 20 GB por mês para a internet.                                                                                                                                                                                                                                             | Transferência de dados                       | Transferência de dados                                     |
| 8   | Ambiente de homologação (opcional)          | Uma cópia menor de 1 e 2, só com dados fictícios, que possa ficar desligada fora do horário de testes.                                                                                                                                                                              | Igual a 1 e 2, menores                       | Igual a 1 e 2, menores                                     |
| 9   | Transcrição de consultas (opcional, futuro) | Fala para texto em **português do Brasil**, processado no Brasil. Volume estimado: cerca de 10 mil minutos por mês (30 consultas × 15 min × 22 dias). Peça só o preço por minuto; não haverá uso real antes de testes com áudio fictício.                                           | Transcribe (comum) em São Paulo              | Speech (fala para texto), se disponível em Brazil South    |
| 10  | Modelo de texto (opcional, futuro)          | Resumo e organização de anotações clínicas, processado **no Brasil**, sem uso para treinamento e sem guarda para monitoramento de abuso. Volume pequeno: algumas centenas de pedidos por dia. Peça o preço e quais modelos atendem a essas condições.                               | Bedrock (com destino confirmado no Brasil)   | Azure OpenAI com implantação regional (Standard) no Brasil |

## 3. Perguntas sobre contrato e dados

Peça que cada resposta venha por escrito e aponte a cláusula do contrato.

1. **Operador na LGPD:** o contrato tem cláusulas de proteção de dados em que vocês agem como
   operador (art. 39)? Existe um termo próprio de tratamento de dados (DPA) em português?
2. **Local dos dados:** os dados e os backups ficam só na região do Brasil escolhida? Em que casos
   algum dado ou registro técnico sai do país?
3. **Suboperadores:** quais empresas podem ter acesso aos dados, e como somos avisados de mudanças?
4. **Acesso do fornecedor:** a equipe de vocês, inclusive o suporte, consegue ler o conteúdo do
   banco? Em que casos e com que registro?
5. **Cópia dos backups:** existe uma segunda região ou local **no Brasil** para guardar a cópia dos
   backups? Se não existir, qual a alternativa sem transferência internacional?
6. **Incidente:** em quanto tempo vocês avisam um incidente de segurança que afete nossos dados, e
   por qual canal? Precisamos desse prazo para cumprir a comunicação à ANPD
   ([resposta a incidentes](resposta-a-incidentes.md)).
7. **Fim do contrato:** como devolvem e eliminam os dados, em que prazo, e se emitem comprovante.
8. **Criptografia:** os dados ficam criptografados em repouso e em trânsito? Podemos usar uma chave
   nossa, guardada no cofre?
9. **Disponibilidade:** qual o compromisso de disponibilidade (SLA) de cada item cotado, e o que
   acontece se não for cumprido?
10. **Suporte:** qual plano de suporte é necessário para atendimento em português, em horário
    comercial, e qual o preço?
11. **Faturamento:** a cobrança pode ser em reais, com nota fiscal brasileira? Se for em dólar,
    quais impostos e taxas entram (por exemplo, IOF)?
12. **Certificações:** quais certificações vocês têm para esses serviços na região do Brasil (por
    exemplo, ISO/IEC 27001 e 27701)? Lembrete nosso: certificação do fornecedor não certifica o
    nosso sistema.

## 4. Perguntas só para os itens de IA (9 e 10)

1. O áudio, o texto enviado e as respostas são usados para treinar ou melhorar modelos? Dá para
   desligar por contrato?
2. O conteúdo fica guardado depois do processamento (por exemplo, para monitoramento de abuso)?
   Por quanto tempo? Dá para pedir que não fique guardado e que não haja revisão humana?
3. Quais modelos ou serviços processam **só no Brasil**? Algum pedido pode ser levado para outra
   região sem a nossa escolha?
4. Existe vocabulário médico ou ajuste para termos médicos em português?

## 5. Tabela para comparar as respostas

| Item ou pergunta                       | AWS | Azure |
| -------------------------------------- | --- | ----- |
| Data da proposta e validade            |     |       |
| Moeda e impostos                       |     |       |
| 1. Servidor da API e do site (mês)     |     |       |
| 2. PostgreSQL sem alta disponibilidade |     |       |
| 2. PostgreSQL com alta disponibilidade |     |       |
| 3. Cópia dos backups                   |     |       |
| 4. Cofre de segredos                   |     |       |
| 5. HTTPS e proxy (e WAF à parte)       |     |       |
| 6. Registros e alertas                 |     |       |
| 7. Tráfego de saída                    |     |       |
| 8. Homologação (opcional)              |     |       |
| Suporte em português                   |     |       |
| **Total mensal de produção (1 a 7)**   |     |       |
| 9. Transcrição (por minuto)            |     |       |
| 10. Modelo de texto (preço e modelos)  |     |       |
| Operador na LGPD e DPA (sim/não)       |     |       |
| Dados e backups só no Brasil (sim/não) |     |       |
| Prazo de aviso de incidente            |     |       |
| Eliminação no fim do contrato          |     |       |
| IA sem treino e sem guarda (sim/não)   |     |       |

## Depois das respostas

- Comparar com os [requisitos de hospedagem](requisitos-de-hospedagem.md): um fornecedor que não
  cumpre um item obrigatório sai da comparação, mesmo que seja mais barato.
- Levar o contrato e o DPA escolhidos para leitura jurídica antes de assinar.
- Só então, com a sua autorização por escrito, criar a conta, e primeiro o ambiente de
  homologação com dados fictícios.
