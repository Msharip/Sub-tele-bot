const { exec } = require('child_process');

// Heroku app name
const appName = 'sub-dzrt-bot';

// Command to restart the dyno
const command = `heroku ps:restart --app ${appName}`;

// Execute the command
exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error(`Error restarting dyno: ${error.message}`);
    return;
  }

  if (stderr) {
    console.error(`Stderr: ${stderr}`);
    return;
  }

  console.log(`Stdout: ${stdout}`);
});
