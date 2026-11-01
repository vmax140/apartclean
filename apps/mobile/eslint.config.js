const expoConfig = require('eslint-config-expo/flat');

module.exports = [{ ignores: ['node_modules/**', '.expo/**', 'expo-env.d.ts'] }, ...expoConfig];
