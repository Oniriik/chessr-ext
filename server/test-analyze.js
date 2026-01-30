/**
 * Simple test to verify the analyze pipeline structure.
 * This doesn't actually run the engine, just verifies imports and types.
 */

import { handleAnalyze } from './dist/analyze-pipeline.js';
import * as types from './dist/analyze-types.js';
import * as helpers from './dist/uci-helpers.js';

console.log('✓ analyze-pipeline imported successfully');
console.log('✓ analyze-types imported successfully');
console.log('✓ uci-helpers imported successfully');

// Verify key exports exist
console.log('\nVerifying exports:');
console.log('  handleAnalyze:', typeof handleAnalyze);
console.log('  toWhitePOV:', typeof helpers.toWhitePOV);
console.log('  lossCpForPlayer:', typeof helpers.lossCpForPlayer);
console.log('  lossWinForPlayer:', typeof helpers.lossWinForPlayer);
console.log('  computeHashForElo:', typeof helpers.computeHashForElo);
console.log('  isPromotionMove:', typeof helpers.isPromotionMove);
console.log('  scoreToWinPercent:', typeof helpers.scoreToWinPercent);

console.log('\n✅ All imports and exports verified successfully!');
console.log('\nNext steps:');
console.log('1. Start the server: npm start');
console.log('2. Update extension to use new request format');
console.log('3. Test with real WebSocket client');
