const fs = require('fs');
async function test() {
  const result = await fetch('http://localhost:3000/api/queues');
  const d = await result.json();
  console.log("Queues:"); 
  console.log(JSON.stringify(d, null, 2));

  const result2 = await fetch('http://localhost:3000/api/history');
  console.log("History size:", (await result2.json()).length);

  const result3 = await fetch('http://localhost:3000/api/current-calling');
  console.log("Current Calling:");
  console.log(JSON.stringify(await result3.json(), null, 2));
}
test().catch(console.error);
