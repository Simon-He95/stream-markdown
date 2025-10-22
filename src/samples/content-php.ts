export const phpContent = `
<?php

function greet(string $name): string {
    return "Hello, $name!";
}

$users = ["Alice", "Bob", "Carol"];
foreach ($users as $u) {
    echo greet($u) . "\n";
}

?>
`
