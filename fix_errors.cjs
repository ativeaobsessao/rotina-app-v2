const fs = require('fs');
let code = fs.readFileSync('src/pages/InviteScreen.tsx', 'utf8');

code = code.replace(
  `setError(err.message || 'Erro ao aceitar convite.');`,
  `let msg = err.message || 'Não foi possível concluir esta ação. Tente novamente.';
      const lower = msg.toLowerCase();
      if (lower.includes('expirado')) msg = 'Este convite expirou. Peça ao administrador da família para gerar um novo.';
      else if (lower.includes('revogado') || lower.includes('utilizado')) msg = 'Este convite não está mais disponível ou já foi utilizado.';
      else if (lower.includes('inválido') || lower.includes('encontrado')) msg = 'Este convite não está mais disponível ou é inválido.';
      else if (lower.includes('já pertence')) msg = 'Você já faz parte desta família.';
      
      setError(msg);`
);

fs.writeFileSync('src/pages/InviteScreen.tsx', code);
