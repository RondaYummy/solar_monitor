module.exports = {
  apps: [
    {
      name: '⛅️ Solar Monitor',
      script: 'dist/src/main.js',
      exec_mode: 'cluster',
      instances: 0,
      autorestart: true,
      max_restarts: 10,
      watch: false,
      time: true,
      shutdown_with_message: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
