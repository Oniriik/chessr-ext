const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const webpack = require('webpack');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  // Load environment variables based on NODE_ENV
  // This must be done inside the function to access the correct NODE_ENV
  const envFile = `.env.${process.env.NODE_ENV || 'development'}`;
  require('dotenv').config({ path: envFile });
  
  console.log(`[Webpack] Loading environment from: ${envFile}`);
  console.log(`[Webpack] STOCKFISH_SERVER_URL: ${process.env.STOCKFISH_SERVER_URL}`);

  return {
    entry: {
      content: './src/content/index.tsx',
    },
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: '[name].js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    plugins: [
      new MiniCssExtractPlugin({
        filename: '[name].css',
      }),
      new CopyPlugin({
        patterns: [
          { from: 'public', to: '.' },
        ],
      }),
      new webpack.DefinePlugin({
        'process.env.STOCKFISH_SERVER_URL': JSON.stringify(
          process.env.STOCKFISH_SERVER_URL || 'ws://localhost:3000'
        ),
        'process.env.NODE_ENV': JSON.stringify(
          process.env.NODE_ENV || 'development'
        ),
      }),
    ],
    devtool: isProduction ? 'source-map' : 'cheap-module-source-map',
  };
};
