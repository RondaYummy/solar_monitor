#!/bin/bash

function deploy() {
  echo "====> Починаємо оновлення проекту"

  # Оновлення репозиторію
  echo "====> Оновлюємо код з Git"
  git pull
  if [ $? -ne 0 ]; then
    echo "❌ Помилка під час оновлення коду з Git"
    exit 1
  fi
  echo "✅ Код успішно оновлено з Git"

  # Встановлення залежностей
  echo "====> Встановлюємо npm залежності"
  npm install
  if [ $? -ne 0 ]; then
    echo "❌ Помилка під час встановлення залежностей"
    exit 1
  fi
  echo "✅ Залежності успішно встановлені"

  # Збірка проекту
  echo "====> Збираємо проект"
  pm2 stop ecosystem.config.js
  npm run build
  if [ $? -ne 0 ]; then
    echo "❌ Помилка під час збірки проекту"
    exit 1
  fi
  echo "✅ Проект успішно зібрано"

  # Перезапуск PM2
  echo "====> Перезапускаємо PM2"
  pm2 restart ecosystem.config.js
  if [ $? -ne 0 ]; then
    echo "❌ Помилка під час перезапуску PM2"
    exit 1
  fi
  echo "✅ PM2 успішно перезапущено"

  echo "====> Оновлення проекту завершено успішно"
}

function check_deploy() {
    changed=0
    git fetch && git status -uno | grep -q 'Your branch is behind' && changed=1

    if [ $changed = 1 ]; then
        deploy
    else
        dt=$(date +%d.%m.%Y\ %H:%M:%S)
        echo "[$dt] Branch is up to date"
    fi
}

cd /root/solar_monitor

while [ 1 ]; do
    check_deploy 2>&1
    sleep 30
done
