const fs = require('fs');
let code = fs.readFileSync('src/pages/InviteScreen.tsx', 'utf8');

code = code.replace(
  `  function goHome() { sessionStorage.setItem('pending_invite', token);
    window.location.href = '/';
  }`,
  `  function goHome(isSuccess = false) { 
    if (!isSuccess) {
      sessionStorage.setItem('pending_invite', token);
    }
    window.location.href = '/';
  }`
);

code = code.replace(
  `<Button className="w-full" size="lg" onClick={goHome}>`,
  `<Button className="w-full" size="lg" onClick={() => goHome(false)}>`
);

code = code.replace(
  `<Button variant="ghost" className="w-full" onClick={goHome}>`,
  `<Button variant="ghost" className="w-full" onClick={() => goHome(false)}>`
);

code = code.replace(
  `onClick={goHome}>
              Entrar`,
  `onClick={() => goHome(true)}>
              Entrar`
);

fs.writeFileSync('src/pages/InviteScreen.tsx', code);
