import { readdirSync } from 'node:fs';

const files = readdirSync('./build/src/commands').filter(f => f.endsWith('.js'));

async function measure(name, path) {
  const start = Date.now();
  try {
    await import(path + '?t=' + start);
    console.log(name + ': ' + (Date.now() - start) + 'ms');
  } catch (e) {
    console.log(name + ': 错误 - ' + e.message.split('\n')[0]);
  }
}

await Promise.all(files.map(f => {
  const name = f.replace('.js', '');
  return measure(name, './build/src/commands/' + f);
}));
