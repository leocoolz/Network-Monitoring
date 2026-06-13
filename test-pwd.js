import argon2 from "argon2";
const hash = "$argon2id$v=19$m=65536,t=3,p=1$wspnU4SVIcSZrOaqdXQbOA$01rvoSJHDV14QjB8Hu6zhmSPhA1fxHAlgIeiOwyWnQo";
argon2.verify(hash, "Administrator!2026").then(console.log);
