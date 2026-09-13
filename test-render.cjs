require('@babel/register')({
  presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'],
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
});

const React = require('react');
const { renderToString } = require('react-dom/server');

// We need a proper DOM environment. Let's just mock it.
// Actually, it's easier to just build it. Wait, I already built it.
