const fs = require('fs');
async function test() {
  const res = await fetch('http://localhost:3000/api/call-next/Farmácia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ medico: 'Consultório 1 - Anahy Duarte' })
  });
  console.log(res.status);
  console.log(await res.text());
}
test().catch(console.error);
