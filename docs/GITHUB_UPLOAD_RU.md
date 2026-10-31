# API Sentinel: запуск и публикация

## Проверить проект

```sh
npm ci
npm test
npm run build
npm start
```

Открой `http://127.0.0.1:3400`, нажми **Try the demo**. Выбери Catalog API → Simulate outage → Incidents → Acknowledge → Restore service. Opening evidence показывает исходную ошибку, Recovery evidence — проверку, подтвердившую восстановление.

## GitHub

Если загружаешь вручную, создай пустой репозиторий `API-Sentinel`, затем в папке проекта:

```sh
git init -b main
git add .
git commit -m "Build API Sentinel monitoring workspace"
git remote add origin https://github.com/mileevskiyy/API-Sentinel.git
git push -u origin main
```

`.env`, `node_modules`, `data` и локальная база исключены из Git. В Actions появится workflow API Sentinel checks: тесты, сборка и сценарий Chromium.

## Бесплатная демонстрация

Render → New Web Service → GitHub → API-Sentinel → Docker → Free. Dockerfile расположен в корне репозитория.

Переменные: `PUBLIC_DEMO=true`, `SEED_DEMO=true`, `HOST=0.0.0.0`, `PORT=10000`, `COOKIE_SECURE=true`, `RUN_SCHEDULER=false`.

В демке не нужна отдельная база и пароль. У всех посетителей общий набор примеров, который сбрасывается после перезапуска. Фоновый мониторинг в демке отключён; проверки запускаются кнопками. Для реальных внешних API используй private mode из README.
