module.exports = {
  apps: [
    {
      name: '⛅️ Solar Monitor',
      script: 'dist/src/main.js',
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      instances: 1,
      watch: false,
      time: true,
      shutdown_with_message: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
