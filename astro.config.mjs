import { defineConfig } from 'astro/config';

export default defineConfig(({ command }) => ({
  output: 'static',
  site: 'https://kage7047.github.io',
  base: command === 'build' ? '/Sidequest' : '/',
}));
