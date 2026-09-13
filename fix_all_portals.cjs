const fs = require('fs');
let code = fs.readFileSync('src/components/ui/UserProfile.tsx', 'utf8');

// Replace showNameModal
code = code.replace(
  /\{showNameModal && \([\s\S]*?<\/div>\s*<\/div>\s*\)\}/,
  (match) => {
    return `{showNameModal && createPortal(\n${match.substring(18, match.length - 1)},\n        document.body\n      )}`;
  }
);

// Replace showPasswordModal
code = code.replace(
  /\{showPasswordModal && \([\s\S]*?<\/div>\s*<\/div>\s*\)\}/,
  (match) => {
    return `{showPasswordModal && createPortal(\n${match.substring(22, match.length - 1)},\n        document.body\n      )}`;
  }
);

fs.writeFileSync('src/components/ui/UserProfile.tsx', code);
