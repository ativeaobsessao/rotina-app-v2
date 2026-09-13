const fs = require('fs');
let code = fs.readFileSync('src/pages/InviteScreen.tsx', 'utf8');

code = code.replace(
  `<Button className="w-full" size="lg" onClick={() => goHome(false)}>
              Criar conta ou Entrar
            </Button>`,
  `<div className="space-y-3">
              <Button className="w-full" size="lg" onClick={() => goHome(false)}>
                CRIAR MINHA CONTA
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => goHome(false)}>
                JÁ TENHO UMA CONTA
              </Button>
            </div>`
);

fs.writeFileSync('src/pages/InviteScreen.tsx', code);
