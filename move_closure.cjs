const fs = require('fs');
let code = fs.readFileSync('src/pages/Today.tsx', 'utf8');

// Find the closure block
const closureRegex = /\{\/\* Closure Area \*\/\}[\s\S]*?(?=\{\/\* Timeline \*\/})/m;
const match = code.match(closureRegex);

if (match) {
  const closureCode = match[0];
  code = code.replace(closureCode, ''); // Remove it from the top
  
  // Insert it after the timeline
  code = code.replace(
    "          {events.length === 0 && (",
    closureCode + "\n          {events.length === 0 && ("
  );
  
  fs.writeFileSync('src/pages/Today.tsx', code);
  console.log("Moved successfully.");
} else {
  console.log("Regex not matched.");
}
