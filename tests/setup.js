process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only';  
process.env.API_KEY_PEPPER = process.env.API_KEY_PEPPER || 'test-pepper-for-testing-only';  
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test'; 

jest.setTimeout(10000);

beforeAll(() => {
    if (!process.env.JWT_SECRET) {
        process.env.JWT_SECRET = 'fallback-test-secret';  
    }
})