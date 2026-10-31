import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { input, password as askPassword } from "@inquirer/prompts";
import { checkCredentials } from "./authentication";
import {createEmailCodeTable, sendLoginCode, verifyLoginCode} from "./emailCodes";


const databasePath = resolve(
    import.meta.dir,
    "..",
    "data",
    "PMSB.db"
);

const database = new Database(databasePath, {
    readwrite: true,
    create: false
});

database.exec("PRAGMA foreign_keys = ON");
database.exec("PRAGMA busy_timeout = 5000");


async function main() {
    createEmailCodeTable(database);
    const username = await input({
        message: "Username:"
    });

    const enteredPassword = await askPassword({
        message: "Password:",
        mask: true
    });

    const account = await checkCredentials(
        database,
        username,
        enteredPassword
    );

    console.log("\nPassword accepted. Sending your email code...");

const codeId = await sendLoginCode(
    database,
    account.userId
);

console.log("Check your registered inbox and spam folder.");

const enteredCode = await input({
    message: "Six-digit code:"
});

const verifiedAccount = verifyLoginCode(
    database,
    codeId,
    enteredCode.trim()
);

console.log("\nPassword and email code accepted.");
console.log("Account:", verifiedAccount.username);
console.log("Role:", verifiedAccount.role);
console.log("No dashboard session created yet.");
}


try {
    await main();

} catch (error) {
    if (error instanceof Error) {
        console.error(error.message);
    } else {
        console.error("Could not check the account.");
    }

    process.exitCode = 1;

} finally {
    database.close();
}