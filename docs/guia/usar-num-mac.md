# Usar o CRM num Mac, sem hospedagem

> Para testar o CRM no seu próprio Mac, **só com dados fictícios**, antes de contratar uma
> hospedagem. O CRM ainda não passou pela conferência médica e jurídica
> ([a conferir](../revisao/a-conferir.md)) e não está pronto para dados reais de pacientes.

## Como fica

- O Mac é o servidor: o banco de dados, a API e o site rodam nele.
- No Mac, o CRM abre no navegador em `http://localhost:5173`.
- No celular, o CRM abre só enquanto o Mac estiver ligado e os dois estiverem **no mesmo Wi-Fi**.
  Fora dessa rede, o celular não acessa.
- Quando precisar de mais computadores ou de acesso de fora, contrata-se uma VPS
  ([pedido de cotação](../operacao/pedido-de-cotacao.md)) e os dados passam do Mac para ela com o
  [backup e restauração](../operacao/backup-e-restauracao.md).

## 1. Instalar as ferramentas (uma vez)

Abra o Terminal (Cmd + Espaço, digite "Terminal"). Instale o [Homebrew](https://brew.sh) com o
comando do site oficial, digite a senha do Mac quando ele pedir e rode as linhas de "Next steps"
que ele mostrar no final. Depois:

```bash
brew install node@22 postgresql@16 age gh coreutils   # coreutils traz o sha256sum dos backups
brew services start postgresql@16
# node@22 e postgresql@16 não entram sozinhos no caminho dos comandos:
echo 'export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
```

## 2. Baixar o código e preparar o banco (uma vez)

```bash
gh auth login                       # entra na sua conta do GitHub pelo navegador
cd "$HOME/CRM CLINICA"
gh repo clone jrms0106-droid/crm-medico
cd crm-medico
cp .env.example .env                # valores só de desenvolvimento

# papel e bancos locais, com a mesma senha de desenvolvimento do .env.example
psql postgres -c "CREATE ROLE crm LOGIN CREATEROLE PASSWORD 'crm_dev_only'"
psql postgres -c "CREATE DATABASE crm_dev OWNER crm"
psql postgres -c "CREATE DATABASE crm_test OWNER crm"

npm install
npm run db:migrate
npm run db:seed                     # clínica e pacientes fictícios
npm run build
```

## 3. Abrir o CRM (cada vez que for usar)

```bash
cd "$HOME/CRM CLINICA/crm-medico"
npm run dev
```

Abra `http://localhost:5173` e entre com um dos usuários fictícios do
[README](../../README.md#como-rodar-no-seu-computador). Para parar, aperte Ctrl + C no Terminal.

## 4. Abrir no celular, pelo mesmo Wi-Fi (opcional)

Em vez de `npm run dev`, use dois Terminais:

```bash
npm run dev --workspace @crm/api                    # Terminal 1: a API
npm run dev --workspace @crm/web -- --host          # Terminal 2: o site, visível na rede
```

O Terminal 2 mostra uma linha "Network", por exemplo `http://192.168.0.10:5173`. Abra esse
endereço no navegador do celular.

Cuidados:

- Na rede local o endereço é `http`, sem cadeado: quem estiver no mesmo Wi-Fi poderia ver o que
  passa. Por isso, **só dados fictícios** e só numa rede de confiança (nunca Wi-Fi público).
- Sem cadeado, o celular não oferece "instalar como aplicativo". Isso passa a funcionar na VPS,
  que terá `https`.

## 5. Cópia de segurança (antes de cadastrar qualquer coisa que queira guardar)

Se o Mac quebrar ou for roubado, os dados vão junto. Use os scripts de
[backup](../operacao/backup-e-restauracao.md) para gravar uma cópia cifrada num HD externo:

```bash
age-keygen -o "$HOME/chave-backup-crm.txt"        # chave PRIVADA: guarde fora do Mac (cofre de senhas)
age-keygen -y "$HOME/chave-backup-crm.txt" > "$HOME/chave-backup-crm.pub"   # chave pública

# com o HD externo ligado (troque "HD-EXTERNO" pelo nome dele no Finder)
cd "$HOME/CRM CLINICA/crm-medico"
DATABASE_URL_BACKUP="postgresql://crm:crm_dev_only@localhost:5432/crm_dev" \
  BACKUP_DIR="/Volumes/HD-EXTERNO/backup-crm" \
  AGE_RECIPIENTS_FILE="$HOME/chave-backup-crm.pub" \
  scripts/ops/backup.sh
```

Depois de copiar a chave privada para o cofre de senhas, apague-a do Mac. Sem ela, nenhuma cópia
pode ser lida, nem por quem levar o HD. Para voltar uma cópia, siga
[restauração](../operacao/backup-e-restauracao.md).

## Limites

- Este jeito serve para teste e para uma pessoa. Não tem backup fora do Mac por padrão, nem
  acesso de fora, nem funcionamento com o Mac desligado.
- Os comandos do Homebrew e os caminhos `/opt/homebrew` (Macs com chip Apple) não foram
  executados num Mac. Os comandos do projeto (`npm`, banco, `--host`) foram conferidos em Linux.
