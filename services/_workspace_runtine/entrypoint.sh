#!/bin/sh

TEMPLATE="${TEMPLATE:-react}"

# Only generate the app if it doesn't already exist
if [ ! -d "my-app" ]; then
  echo "Creating Vite app with template: $TEMPLATE..."
  npm create vite@latest my-app -- --template $TEMPLATE
  
  cd my-app
  npm install
  cd ..
  npm run dev -- --host 0.0.0.0
fi

exec "$@"
