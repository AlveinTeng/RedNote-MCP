// test-search.mjs
import { RedNoteTools } from './dist/tools/rednoteTools.js';

async function main() {
  const keyword = process.argv[2] || "food";
  const limit = Number(process.argv[3]) || 10;
  
  console.log(`Searching for posts with keyword: "${keyword}", limit: ${limit}`);
  
  try {
    const tools = new RedNoteTools();
    console.log('Initializing RedNoteTools...');
    
    const notes = await tools.searchNotes(keyword, limit);
    
    console.log(`\n✅ Found ${notes.length} posts:\n`);
    
    notes.forEach((note, index) => {
      console.log(`--- Post ${index + 1} ---`);
      console.log(`Title: ${note.title}`);
      console.log(`Author: ${note.author}`);
      console.log(`Content: ${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}`);
      console.log(`Likes: ${note.likes || 0}`);
      console.log(`Comments: ${note.comments || 0}`);
      console.log(`URL: ${note.url}`);
      console.log('');
    });
    
    // Save to file
    const fs = await import('fs');
    fs.writeFileSync('search-results.json', JSON.stringify(notes, null, 2), 'utf-8');
    console.log(`✅ Results saved to search-results.json`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
