import { fetchProducers, fetchBpJson  } from '../services/producerService';
import { checkNode } from '../services/nodeService';
import { triggerFeeMultiplierFetch } from '../services/feeService';
import { triggerBundleFetch } from '../services/bundleService';
import { fetchProposals } from '../services/proposalService';
import { calculateNodeScores, calculateProducerScores } from '../services/scoringService';
import { logger_log, logger_error } from './logger';
import { triggerToolsFetch } from "../services/toolsService";
import { triggerProducerChainMap } from "../services/chainMapService";
import {fetchVoters} from "../services/voterService";

// Initial build of db
export async function initialBuild() {
    const processes = [
        { name: 'fetchProducers', func: fetchProducers },
        { name: 'fetchBpJson', func: fetchBpJson },
        { name: 'checkNode', func: checkNode },
        { name: 'triggerFeeMultiplierFetch', func: triggerFeeMultiplierFetch },
        { name: 'triggerBundleFetch', func: triggerBundleFetch },
        { name: 'fetchProposals', func: fetchProposals },
        { name: 'triggerToolsFetch', func: triggerToolsFetch },
        { name: 'triggerProducerChainMap', func: triggerProducerChainMap },
        { name: 'calculateNodeScores', func: calculateNodeScores },
        { name: 'calculateProducerScores', func: calculateProducerScores },
        { name: 'calculateProducerScores', func: calculateProducerScores },
        { name: 'fetchVoters', func: fetchVoters }
    ];

    for (const process of processes) {
        try {
            await process.func();
            logger_log('INITIAL_BUILD', `${process.name} ran successfully.`);
        } catch (error) {
            if (error instanceof Error) {
                logger_error('INITIAL_BUILD', `${process.name} failed.`, error);
            } else {
                logger_log('INITIAL_BUILD', `${process.name} failed with an unknown error.`);
            }
        }
    }
}