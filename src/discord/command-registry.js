'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadCommands(directory = path.join(__dirname, 'commands')) {
  const files = fs.readdirSync(directory)
    .filter((file) => file.endsWith('.js'))
    .sort((left, right) => left.localeCompare(right, 'en'));
  const commands = [];
  const names = new Set();

  for (const file of files) {
    const command = require(path.join(directory, file));
    if (!command?.data?.name || typeof command.execute !== 'function') {
      throw new Error(`Discord command module ${file} must export data.name and execute().`);
    }
    if (names.has(command.data.name)) throw new Error(`Duplicate Discord command name: ${command.data.name}.`);
    names.add(command.data.name);
    commands.push(command);
  }

  return commands;
}

module.exports = { loadCommands };
