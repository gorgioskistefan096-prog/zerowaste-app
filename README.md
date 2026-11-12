# ZeroWaste AI

Marketplace за спасување вишок храна со React/Vite, Express, Supabase и Avalanche Fuji.

## Локално стартување во Windows

1. Во прв PowerShell прозорец стартувај MongoDB на посебната порта `27018`:

```powershell
cd "C:\Users\gorgi\Downloads\ZeroWaste AI\ZeroWaste AI\zerowaste-app"
New-Item -ItemType Directory -Force -Path ".\data\mongodb" | Out-Null
& "C:\Program Files\MongoDB\Server\8.3\bin\mongod.exe" --dbpath ".\data\mongodb" --port 27018 --bind_ip 127.0.0.1
```

Остави го прозорецот отворен. Во MongoDB Compass поврзи се на `mongodb://127.0.0.1:27018`.

2. Во втор PowerShell прозорец стартувај API и веб-апликација:

```powershell
cd "C:\Users\gorgi\Downloads\ZeroWaste AI\ZeroWaste AI\zerowaste-app"
npm run dev:full
```

Отвори `http://127.0.0.1:5175`. Локалната база е `zerowaste_ai`.

## Деплој на smart contract на Fuji

Договорот е во `contracts/ZeroWasteMarketplace.sol` и е V3. Бизнисот плаќа членарина еднаш на 30 дена; во овој тест `0.01 AVAX` се прикажува како `500 МКД` (фиксна тест-пресметка `1 AVAX = 50.000 МКД`). Додека членарината важи, бизнисот може да поднесува неограничени понуди со бесплатен MetaMask потпис. Новите понуди остануваат скриени додека администраторот не ги одобри. Купувачот плаќа за секој пакет со Fuji трансакција; AVAX се чува во escrow и се исплаќа на бизнисот по потврда на подигнувањето.

1. Компajлирај со `npm run contract:compile`.
2. Во Remix отвори го `contracts/ZeroWasteMarketplace.sol`. Избери compiler `0.8.38`, optimizer со 200 runs и EVM version `cancun`.
3. Во Deploy & Run избери **Injected Provider - MetaMask**, поврзи се на Fuji (chain ID `43113`), провери тест AVAX за gas, па притисни **Deploy** и потврди во MetaMask. Ова е единствената администраторска MetaMask трансакција за поставување на договорот. Fuji RPC е `https://api.avax-test.network/ext/bc/C/rpc`.
4. Копирај ја новата deployed адреса во `MARKETPLACE_ADDRESS` и `VITE_MARKETPLACE_ADDRESS` во локалната `.env` и во продукциските environment variables на хостингот. На Vercel, зачувај ги промените и направи нов redeploy за Vite да ја вгради адресата.
5. Бизнисот плаќа членарина еднаш од својот wallet за 30 дена; објавувањето на секоја понуда е бесплатен потпис. Купувачот плаќа од својот wallet. Одобрувањето на објавата го прави администраторот преку админ панелот, без MetaMask трансакција. Понудите од старите договори не се пренесуваат автоматски; објави ги повторно.

## Администратор

Постави `ADMIN_EMAIL` и `ADMIN_PASSWORD` во `.env` (локално) или во environment variables на Render. Лозинката мора да има најмалку 12 знаци. При првото поврзување со базата серверот креира/освежува администраторска сметка со тие податоци. Најави се преку вообичаениот формулар со email и лозинка; ќе се појави табот **Админ · одобрувања**. Не дозволувај јавно да се користи администраторскиот email.

Не внесувај seed phrase или private key во кодот или `.env`.

## Јавно објавување на интернет преку Render

`render.yaml` е подготвен за една јавна Node веб-апликација која ги сервира React страницата и Express API-то. Render ѝ доделува јавна `onrender.com` адреса. Јавниот сервис мора да користи MongoDB Atlas; `mongodb://127.0.0.1:27018` е достапна само на твојот компјутер.

1. Креирај MongoDB Atlas cluster и database user. Во Atlas **Network Access** дозволи ги outbound IP ranges што ќе ги прикаже Render за сервисот: **Connect → Outbound**. Atlas прифаќа врски само од дозволени IP адреси; не отворај пристап од сите IP адреси.
2. Направи GitHub repository чиј root е оваа папка и push-ни го проектот. Не додавај `.env`, `data/mongodb` или други тајни.
3. Во Render избери **New → Blueprint**, поврзи го repository-то и deploy-ни го `render.yaml`. Кога ќе побара `MONGODB_URI`, внеси го Atlas connection string-от директно во Render Dashboard; не го праќај во chat. Render автоматски генерира `JWT_SECRET`.
4. Во Render environment settings внеси ја Fuji адресата и за `MARKETPLACE_ADDRESS` и за `VITE_MARKETPLACE_ADDRESS`, ако договорот веќе е deploy-нат. По промена на `VITE_MARKETPLACE_ADDRESS` направи redeploy бидејќи Vite ја вградува вредноста во build-от.
5. Кога `/api/health` ќе врати `database: connected`, Render јавниот URL може да се сподели.

Локалните сметки остануваат во локалната MongoDB база и не се копираат автоматски во Atlas. Јавниот Atlas cluster ќе започне празен, освен ако подоцна не одобриш миграција. Бесплатните Render web services може да заспијат по период на неактивност, па првото отворање може да биде побавно.

`.env` и локалните MongoDB датотеки се исклучени од Git.
