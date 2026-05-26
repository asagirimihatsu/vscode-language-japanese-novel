/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

'use strict';

/** @typedef {import('webpack').Configuration} WebpackConfig **/

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

/** @type WebpackConfig */
const extensionConfig = {
	mode: 'none',
	target: 'node',
	entry: {
		extension: './src/extension.ts',
	},
	experiments: {
		outputModule: true,
	},
	output: {
		filename: '[name].js',
		path: path.join(__dirname, './dist'),
		module: true,
		chunkFormat: 'module',
		library: { type: 'module' },
		environment: { module: true, dynamicImport: true },
		devtoolModuleFilenameTemplate: '../[resource-path]',
	},
	devtool: 'source-map',
	externalsType: 'module-import',
	externals: {
		vscode: 'module vscode',
	},
	resolve: {
		mainFields: ['module', 'main'],
		extensions: ['.ts', '.js'],
		extensionAlias: {
			'.js': ['.ts', '.js'],
		},
	},
	module: {
		rules: [
			{
				test: /\.ts$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							configFile: path.resolve(__dirname, 'tsconfig.extension.json'),
						},
					},
				],
			},
		],
	},
	performance: {
		hints: false,
	},
	infrastructureLogging: {
		level: 'log',
	},
};

/** @type WebpackConfig */
const webviewConfig = {
	mode: 'none',
	entry: './src/webview/treeApp.tsx',
	output: {
		path: path.resolve(__dirname, 'dist/webview'),
		filename: 'bundle.js',
	},
	resolve: {
		extensions: ['.jsx', '.js', '.tsx', '.ts'],
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							configFile: path.resolve(__dirname, 'tsconfig.webview.json'),
						},
					},
				],
			},
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader'],
			},
		],
	},
	plugins: [
		new webpack.DefinePlugin({
			'process.env.NODE_ENV': JSON.stringify('production'),
		}),
	],
};

/** @type WebpackConfig */
const vivlioView = {
	mode: 'none',
	entry: './src/vivlioViewser/main.ts',
	output: {
		filename: 'vivlio.js',
		path: path.resolve(__dirname, 'dist/vivlioViewer'),
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				exclude: /node_modules/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							configFile: path.resolve(__dirname, 'tsconfig.webview.json'),
						},
					},
				],
			},
			{
				test: /\.scss$/,
				use: ['style-loader', 'css-loader', 'sass-loader'],
			},
		],
	},
	plugins: [
		new webpack.DefinePlugin({
			'process.env.NODE_ENV': JSON.stringify('production'),
		}),
		new HtmlWebpackPlugin({
			template: './src/vivlioViewser/template.html',
			filename: 'index.html',
		}),
	],
};

module.exports = [extensionConfig, webviewConfig, vivlioView];
