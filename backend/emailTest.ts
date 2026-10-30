import { randomInt } from "node:crypto";
import { sendVerificationEmail } from "./email";

async function main() {
    const enteredEmail = prompt("Send a test code to which email address?");

    if (enteredEmail === null || enteredEmail.trim() === "") {
        console.log("No email address entered.");
        return;
    }

    const email = enteredEmail.trim();

    // Generating Random 6 Digit code.
    const code = String(randomInt(100000, 1000000));

    await sendVerificationEmail(email, code);

    console.log("Gmail accepted the message for sending.");
    console.log("Check the recipient's inbox and junk folder.");
    console.log("This test checks delivery, not account verification.");
}

try {
    await main();
} catch (error) {
    console.error("Email test failed.");

    if (error instanceof Error) {
        console.error("Error type:", error.name);
        console.error("Message:", error.message || "No message provided");

        if ("code" in error) {
            console.error("Error code:", error.code);
        }

        if ("responseCode" in error) {
            console.error("SMTP response code:", error.responseCode);
        }
    } else {
        console.error("Error details:", String(error));
    }
    if (error instanceof AggregateError) {
    for (const connectionError of error.errors) {
        if (connectionError instanceof Error) {
            console.error(
                "Connection message:",
                connectionError.message
            );

            if ("code" in connectionError) {
                console.error(
                    "Connection code:",
                    connectionError.code
                );
            }
        }
    }
}

    process.exitCode = 1;
}