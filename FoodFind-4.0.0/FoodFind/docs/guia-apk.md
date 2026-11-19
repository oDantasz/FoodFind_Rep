# FoodFind 4.0.0 — Guia para gerar um APK (Android)

O FoodFind já é um **PWA** (manifest, ícones e service worker). Ele pode ser instalado direto pelo navegador. Se o professor exigir um **APK**, há dois caminhos. Os dois exigem que o FoodFind esteja publicado em um endereço **HTTPS** público (ex.: `https://foodfind.seudominio.com.br`), com `PUBLIC_URL` apontando para ele.

---

## Caminho 1 — PWABuilder (mais simples, sem programar)
Gera um app Android do tipo *Trusted Web Activity* (TWA), que abre o site em tela cheia.

1. Publique o FoodFind em HTTPS e confira se `https://SEU_DOMINIO/manifest.webmanifest` e `https://SEU_DOMINIO/sw.js` abrem.
2. Acesse **https://www.pwabuilder.com**, cole a URL do site e clique em **Start**.
3. O PWABuilder analisa o manifest. Em **Package for stores**, escolha **Android** → **Generate Package**.
4. Preencha:
   - *Package ID*: `br.edu.fatec.foodfind`
   - *App name*: `FoodFind` · *Launcher name*: `FoodFind`
   - *Version*: `4.0.0` · *Version code*: `4`
   - *Signing key*: **Create new** (guarde o arquivo `.keystore` e as senhas; são necessários para atualizar o app).
5. Baixe o `.zip`. Ele contém o **APK** (para instalar/testar) e o **AAB** (para a Google Play), além do arquivo `assetlinks.json`.
6. **Digital Asset Links** (remove a barra de endereço do app): publique o conteúdo de `assetlinks.json` em `https://SEU_DOMINIO/.well-known/assetlinks.json`. No FoodFind, basta criar a pasta `public/.well-known/` com esse arquivo e publicar novamente.
7. Instale o APK no celular: copie o arquivo, abra e permita "instalar apps desconhecidos". Teste: localização, câmera (Ler QR Code) e login.

## Caminho 2 — Capacitor (projeto Android próprio)
Use se precisar abrir no Android Studio ou personalizar o app.

Pré-requisitos: Node.js 20, Android Studio (com SDK e um emulador ou celular em modo desenvolvedor) e JDK 17.

```bash
mkdir foodfind-android && cd foodfind-android
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init FoodFind br.edu.fatec.foodfind --web-dir www
mkdir www && echo '<!doctype html><meta http-equiv="refresh" content="0;url=https://SEU_DOMINIO/">' > www/index.html
```

Edite `capacitor.config.json` para carregar o site publicado:

```json
{
  "appId": "br.edu.fatec.foodfind",
  "appName": "FoodFind",
  "webDir": "www",
  "server": { "url": "https://SEU_DOMINIO", "cleartext": false }
}
```

```bash
npx cap add android
npx cap open android        # abre no Android Studio
```

No Android Studio:
1. Em `android/app/src/main/AndroidManifest.xml`, adicione as permissões:
   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   <uses-permission android:name="android.permission.CAMERA" />
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
   ```
2. **Build → Build Bundle(s) / APK(s) → Build APK(s)**. O arquivo fica em `android/app/build/outputs/apk/debug/app-debug.apk`.
3. Para um APK assinado: **Build → Generate Signed Bundle / APK**.

## Observações
- O app usa o mesmo servidor e o mesmo login do site; não há dados guardados no aparelho além do cookie de sessão.
- A câmera e a localização pedem permissão na primeira vez, como no navegador.
- Este guia não foi executado no ambiente de desenvolvimento do projeto (exige domínio HTTPS público e Android Studio). Siga e registre o resultado no checklist de homologação.
