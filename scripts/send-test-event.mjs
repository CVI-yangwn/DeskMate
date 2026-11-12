const result = process.argv[2] === 'fail' ? 'fail' : 'pass';

try {
  const response = await fetch('http://127.0.0.1:39876/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'test.result', result }),
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
  if (!response.ok || !data.ok) process.exitCode = 1;
} catch (error) {
  console.error('DeskMate 还没启动？先 npm run dev，再运行这个脚本。');
  console.error(String(error));
  process.exitCode = 1;
}
