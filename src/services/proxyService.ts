import { prisma } from '../config/database';

// Queries db for proxies
export async function getProxiesQuery(
    chainValue: 'mainnet' | 'testnet' = 'mainnet'
) {
    const chain = chainValue === 'mainnet' ? 'Mainnet' : 'Testnet';

    const proxies = await prisma.proxies.findMany({
        where: { chain }
    });

    return proxies.map(proxy => ({
        owner: proxy.owner,
        fio_address: proxy.fio_address,
        vote: proxy.vote,
        delegators: proxy.delegators
    }));
}