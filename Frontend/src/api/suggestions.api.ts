import { apiRequest } from './client';

export const suggestionsApi = {
    create: (data: { message: string; userId: string; userName?: string | null; tenantId?: string | null }) =>
        apiRequest<any>('/suggestions', {
            method: 'POST',
            body: JSON.stringify(data),
        }),
};
