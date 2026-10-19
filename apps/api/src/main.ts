import { Logger } from '@nestjs/common';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.API_PORT);
new Logger('Bootstrap').log(`API ouvindo na porta ${config.API_PORT} (dados fictícios apenas)`);
