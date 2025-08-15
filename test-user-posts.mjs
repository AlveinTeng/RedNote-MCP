// test-user-posts.mjs
import { RedNoteTools } from './dist/tools/rednoteTools.js';

async function main() {
  const profileUrl = process.argv[2] || "https://www.xiaohongshu.com/user/profile/64890886000000001f004ac3?xsec_token=AB1FwTvZy-H1kB9f3dBb20g_xt_4oCrYWeCN3kiZ1XIg8=&xsec_source=pc_feed";
  const limit = process.argv[3] ? Number(process.argv[3]) : undefined;
  
  console.log(`Getting posts from user profile: ${profileUrl}`);
  if (limit) {
    console.log(`Limit: ${limit} posts`);
  } else {
    console.log('No limit specified - will get all available posts');
  }
  
  try {
    const tools = new RedNoteTools();
    console.log('Initializing RedNoteTools...');
    
    const notes = await tools.getUserPosts(profileUrl, limit);
    
    console.log(`\n✅ Found ${notes.length} posts:\n`);
    
    notes.forEach((note, index) => {
      console.log(`--- Post ${index + 1} ---`);
      console.log(`Title: ${note.title}`);
      console.log(`Author: ${note.author}`);
      console.log(`Content: ${note.content.substring(0, 300)}${note.content.length > 300 ? '...' : ''}`);
      console.log(`Likes: ${note.likes || 0}`);
      console.log(`Collects: ${note.collects || 0}`);
      console.log(`Comments: ${note.comments || 0}`);
      console.log(`URL: ${note.url}`);
      console.log('');
    });
    
    // Save to file
    const fs = await import('fs');
    const filename = `user-posts-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(notes, null, 2), 'utf-8');
    console.log(`✅ Results saved to ${filename}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

main();
