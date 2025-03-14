import { Request, Response } from 'express';
import { getProxiesQuery } from '../services/proxyService';
import { logger_error } from '../utils/logger';

export const getProxies = async (req: Request, res: Response) => {
    try {
        const { chain } = req.query;
        const chainValue = chain as 'mainnet' | 'testnet' | undefined;

        const proxies = await getProxiesQuery(chainValue);
        res.json(proxies);
    } catch (error) {
        logger_error('PROXIES', 'Error in getProxies:', error);
        res.status(500).json({ error: 'An error occurred while fetching proxies.' });
    }
};