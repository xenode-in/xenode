extern "C" {
    int main1(char* xmlPath) {
        char *argv[2] = {
            "",
            xmlPath
        };

        return main(2, argv);
    }
}
