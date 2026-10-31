// 'types.ts' = Describes the data returned by the API.
export type Account = {
    userId: number;
    username: string;
    email: string | null;
    role: string;
};

export type Reading = {
    frameId: number;
    runId: string;
    bridgeId: string;
    step: number;
    scenario: string;
    recordedAt: string;
    simulatedHour: number;
    sensorName: string;
    value: number;
    unit: string;
};

export type UserRow = Account & {
    isActive: number;
    createdAt: string;
};

export function roleLabel(role: string) {
    if (role === "superAdmin") {
        return "Super admin";
    }
    if (role === "admin") {
        return "Admin";
    }
    if (role === "employee") {
        return "Employee : Read only";
    }
    return role;
}
